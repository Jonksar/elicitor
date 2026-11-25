# @elicitor/react

Headless React bindings for Elicitor: a provider, hooks and transports. It renders nothing visible
and ships no styles. `@elicitor/react-ui` builds the styled widget on top of it; use this package
directly when you want your own UI.

The reporter's flow:

1. **idle**: nothing is open.
2. **selecting**: the reporter marks a screen region (or picks the whole view).
3. **composing**: the reporter writes one sentence.
4. **submitting**: the report is being created. The assistant's first question is created along with it.
5. **thread**: the conversation. The reporter answers questions, then confirms the summary the
   assistant reads back (or corrects it by replying again).

```tsx
import { ElicitorProvider, createFetchTransport, useElicitor, useReport } from "@elicitor/react";

const transport = createFetchTransport("/api/elicitor", { credentials: "include" });

export function App() {
  return (
    <ElicitorProvider transport={transport} locale="en" getMetadata={() => ({ workspaceId })}>
      <Routes />
      <ReportWidget />
    </ElicitorProvider>
  );
}
```

`peerDependencies` allow React 18 and later (`react >=18`), and the hooks use only APIs React 18
has, but the tests run on React 19 only. The package has no runtime dependencies besides
`@elicitor/core` and `@elicitor/capture`.

## Exports

From `@elicitor/react`:

- Component: `ElicitorProvider`.
- Hooks: `useElicitor`, `useReport`, `useCapture`.
- Transport factory: `createFetchTransport`.
- Errors: `ElicitorTransportError` and `isElicitorTransportError`, `ElicitorActionError` and
  `isElicitorActionError`.
- Constant: `CONSOLE_ERROR_LIMIT` (`30`).
- Types: `ElicitorProviderProps`, `ElicitorCaptureConfig`, `ElicitorApi`, `FlowState`, `FlowStep`,
  `OpenOptions`, `CreateReportOptions`, `ReportsState`, `LoadStatus`, `ReportState`,
  `ReportAction`, `CaptureApi`, `CaptureStartOptions`, `FetchTransportOptions`,
  `ElicitorActionErrorCode`.
- Types re-exported from `@elicitor/capture`: `CaptureResult`, `RegionSelectLabels`,
  `RegionSelectOptions`, `RequestLog`.
- Types re-exported from `@elicitor/core`: `ElicitorTransport`, `CreateReportInput`,
  `ReportListItem`, `ReportDetail`, `ReportStatus`, `Summary`, `SummaryKind`, `MessageAuthor`,
  `Region`, `CaptureContext`, `RequestLogEntry`, `ConsoleErrorEntry`.

From `@elicitor/react/testing`: `createMemoryTransport`, and the types `MemoryTransport` and
`MemoryTransportOptions`.

## Error contract

These rules hold for every hook:

- **Loads never reject.** That covers `reports.refresh()` and `useReport().refresh()`, including
  the automatic load when the id changes. A failure is stored in `status: "error"` and `error`.
- **Actions reject.** That covers `submit`, `createReport`, `reply`, `confirm` and `withdraw`. A
  transport failure is also stored in the hook's state (`flow.error` or `error` / `failed`) and
  passed to the provider's `onError`. Catch the promise when you call an action from an event
  handler (`void reply(text).catch(() => {})`) and render the error from state.
- **Refused actions** reject with `ElicitorActionError` before any request is made. Examples: a
  non-owner action, a reply while another request is in flight, an empty text. They never touch
  state and never call `onError`. A UI that disables its controls from `pending`, `flow.step` and
  `can*` never sees one.
- **Transport errors.** `createFetchTransport` and `createMemoryTransport` both throw
  `ElicitorTransportError` with `status` and `code`. Read `error.code` structurally: core's
  `ElicitorError` carries a `code` as well.
- **Superseded responses** are dropped silently. A response older than a newer request for the same
  hook never changes state or calls `onError`; its promise still settles. Nothing is applied after
  unmount.

## `<ElicitorProvider>`

```ts
function ElicitorProvider(props: ElicitorProviderProps): ReactElement;

interface ElicitorProviderProps {
  transport: ElicitorTransport; // required
  locale?: string; // default "en"
  messages?: Readonly<Record<string, string>>; // default {}
  capture?: ElicitorCaptureConfig;
  getRoute?: () => string; // default location.pathname + location.search
  getMetadata?: () => Readonly<Record<string, unknown>> | undefined;
  onReportCreated?: (report: ReportListItem) => void;
  onError?: (error: unknown) => void;
  children?: ReactNode;
}

interface ElicitorCaptureConfig {
  screenshot?: boolean; // default true
  regionText?: boolean; // default true
  maxRegionText?: number; // passed to the region select as is
  userAgent?: boolean; // default true; false sends ""
  consoleErrors?: boolean; // default true
  bundleId?: string; // default decided by @elicitor/capture
  requestLog?: RequestLog | (() => ReadonlyArray<RequestLogEntry>);
  labels?: Partial<RegionSelectLabels>; // { hint, wholeView, cancel } for the overlay
  zIndex?: number;
}
```

- `locale` and `messages` are stored and exposed through `useElicitor()` without any processing.
  This package never reads `messages`; react-ui owns the bundles and resolves keys. `locale` is
  also sent as `CaptureContext.language`, which picks the assistant's language.
- `getMetadata()` is sent as `CreateReportInput.metadata`, the same object, unchanged. Use it to
  send host state the backend needs, such as the selected tenant or company. When it returns
  `undefined`, or is not given, the `metadata` key is left out.
- The route, the context (`collectContext`) and the metadata are captured **when the region select
  finishes**, before the reporter writes the sentence, so they describe the screen that was marked.
  `createReport()` captures them when it is called.
- `capture.consoleErrors` (default on): after mount the provider loads `@elicitor/capture` and
  installs a console error buffer of `CONSOLE_ERROR_LIMIT` (30) entries. It uninstalls the buffer on
  unmount, and also when the option is switched off. The buffer's entries go into
  `context.consoleErrors`. With the option off, no buffer is created and `consoleErrors` is `[]`.
  This is the one case where `@elicitor/capture` loads before the widget opens. With it off, the
  module loads on the first `open()`, `useCapture().start()` or `createReport()`. It is always
  loaded with a dynamic `import()`, never in the main bundle.
- `capture.requestLog`: a `RequestLog` from `createRequestLog()` (its `entries()` is read), or a
  function. Both are read when the context is captured. Without it, the request log is left to
  `collectContext`'s default (empty).
- `onError` receives every transport or capture error a hook stores in its state (see the error
  contract). It never receives `ElicitorActionError`.
- `onReportCreated` is called after `transport.create` resolves, from both `submit()` and
  `createReport()`.
- Every callback prop is read at call time, so it may change between renders.

## `useElicitor()`

```ts
function useElicitor(): ElicitorApi; // throws "useElicitor() must be used inside <ElicitorProvider>"

interface ElicitorApi {
  locale: string;
  messages: Readonly<Record<string, string>>;
  transport: ElicitorTransport;
  flow: FlowState;
  open(options?: OpenOptions): Promise<void>;
  close(): void;
  submit(sentence: string): Promise<ReportListItem>;
  createReport(input: CreateReportOptions): Promise<ReportListItem>;
  reports: ReportsState;
}

type FlowStep = "idle" | "selecting" | "composing" | "submitting" | "thread";
interface FlowState {
  step: FlowStep;
  capture: CaptureResult | null; // set in "composing" and "submitting"
  reportId: string | null; // set in "thread"
  error: unknown; // null when none
}
interface OpenOptions {
  labels?: Partial<RegionSelectLabels>;
  zIndex?: number;
}
interface CreateReportOptions {
  sentence: string;
  capture?: CaptureResult | null;
}
```

Flow transitions:

| Call               | From                              | Result                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open(options?)`   | `idle`, `composing`, `thread`     | `selecting`. Resolves after the region select ends: `composing` with `flow.capture` set; `idle` when the reporter cancels; `idle` with `flow.error` set (plus `onError`) when capture fails. Does not reject on a capture failure.                                             |
| `open()`           | `selecting`                       | Nothing happens (resolves at once).                                                                                                                                                                                                                                            |
| `open()`           | `submitting`                      | Rejects with `ElicitorActionError("busy")`.                                                                                                                                                                                                                                    |
| `open()`           | while `useCapture().start()` runs | Rejects with `ElicitorActionError("busy")`; the flow is not touched.                                                                                                                                                                                                           |
| `close()`          | any except `submitting`           | `idle`; clears capture, reportId and error, and aborts a running region select (its late result is ignored).                                                                                                                                                                   |
| `close()`          | `submitting`                      | Ignored. The sentence dialog cannot be closed while sending.                                                                                                                                                                                                                   |
| `submit(sentence)` | `composing`                       | Trims the text, goes to `submitting`, calls `transport.create`. On success: `thread`, with `flow.reportId` set and `flow.capture` cleared, and resolves with the item. On failure: back to `composing` with the capture kept and `flow.error` set, and rejects with the error. |
| `submit()`         | other steps                       | `ElicitorActionError("invalid_step")`, or `"busy"` while already submitting. An empty sentence after trimming gives `"empty"`.                                                                                                                                                 |

`open()` merges `options.labels` over `capture.labels` key by key, and `options.zIndex` overrides
`capture.zIndex`.

`createReport({ sentence, capture? })` creates a report without touching `flow`. It captures route,
context and metadata now. Without a capture it sends `regionText: []` and `screenshotPng: ""` and
leaves `region` out. Empty sentences reject with `"empty"`.

The `CreateReportInput` that both build:

```ts
{
  sentence,                      // trimmed
  route,                         // getRoute()
  region?,                       // only when capture.region is not null (whole view → omitted)
  regionText,                    // capture.regionText ?? []
  context,                       // collectContext({ language: locale, userAgent, consoleErrors, bundleId?, requestLog? })
  screenshotPng,                 // capture.screenshotPng ?? "" ("" when screenshots are off)
  metadata?,                     // getMetadata(), only when not undefined
}
```

### `reports`

```ts
type LoadStatus = "idle" | "loading" | "ready" | "error";
interface ReportsState {
  items: ReadonlyArray<ReportListItem>; // as transport.list() returned them (newest first)
  status: LoadStatus;
  error: unknown;
  refresh(): Promise<void>; // never rejects
}
```

- The status is `"idle"` until the first `refresh()`. The provider never fetches the list by
  itself. Call `refresh()` when your list view mounts.
- `"loading"` is used only while no successful list is shown. A refresh of a `"ready"` list stays
  `"ready"` and keeps its items until the response arrives.
- On failure the status is `"error"`, the items are kept, and `error` is set. Only the newest
  refresh is applied.
- These updates make no request once the list has loaded (status other than `"idle"`):
  - A report created through `submit()` or `createReport()` is added to the front.
  - A report that `useReport` loads or acts on replaces its row (status, title, unread).

## `useReport(id)`

```ts
function useReport(id: string | null): ReportState;

type ReportAction = "reply" | "confirm" | "withdraw";
interface ReportState {
  report: ReportDetail | null;
  status: LoadStatus;
  error: unknown;
  failed: "load" | ReportAction | null; // what `error` came from
  pending: ReportAction | null;
  canReply: boolean; // report?.canReply ?? false
  canConfirm: boolean; // report?.canConfirm ?? false
  canWithdraw: boolean; // report?.canWithdraw ?? false
  reply(body: string): Promise<ReportDetail>;
  confirm(): Promise<ReportDetail>;
  withdraw(): Promise<void>;
  refresh(): Promise<void>; // never rejects; skipped while a reply or confirm is pending
}
```

- **Loading.** The hook loads `transport.get(id)` on mount and whenever `id` changes. For a `null`
  id: `status: "idle"`, `report: null`, no request. After an id change, the previous report is
  never shown, not even for one render (`report: null`, `status: "loading"`).
- **Status.** `"loading"` lasts until the first load for this id settles. A refresh with a report
  already shown keeps the current status and report until the response arrives. A failed load gives
  `"error"` with `failed: "load"` and keeps the last report, so a reload failure can be shown next to
  the old content. A missing report is a load error whose `error.code` is `"not_found"` (status 404).
- **Ownership.** `canReply`, `canConfirm` and `canWithdraw` are copied from the report: the host
  backend decides who owns it. The hook never infers ownership. When the flag is `false`, the action
  rejects with `ElicitorActionError("not_allowed")` and the transport is not called.
- **`reply(body)`** trims the body and calls `transport.reply(id, body)`. The returned
  `ReportDetail` becomes `report`; no extra GET is made. Use it both to answer a question and to
  correct a pending summary: a correction produces a new summary with a new `pendingSummarySeq`.
- **`confirm()`** calls `transport.confirm(id, report.pendingSummarySeq)` and uses the returned
  detail. When `pendingSummarySeq` is `null` it rejects with
  `ElicitorActionError("no_pending_summary")` without a request. When the server has moved on (the
  reporter replied in another tab), the transport fails with `code: "stale"` (HTTP 409). The hook
  then keeps the report and sets `error` and `failed: "confirm"`. Show the error and call
  `refresh()`: the reloaded report carries the latest seq.
- **`withdraw()`** calls `transport.withdraw(id)`, then `transport.get(id)`, because the endpoint
  returns no body. If only that reload fails, the withdraw has still happened: you get
  `status: "error"` with `failed: "load"`.
- **What is blocked while a request is in flight:**
  - `reply` and `confirm` reject with `"busy"` while `pending` is not `null`.
  - `withdraw` rejects with `"busy"` only while a withdraw is pending. It is allowed during a slow
    reply or confirm, and it supersedes them.
  - `refresh()` does nothing while a reply or confirm is pending: a reload could show the report
    from before the assistant's turn and would drop the action's answer, which is the fresh state.
    During a withdraw it runs and supersedes the withdraw's own reload.
  - To disable controls: answer and confirm need `pending === null`; withdraw needs
    `pending !== "withdraw"`.
- **Ordering.** Every load and action takes a ticket, and a response is applied only while its
  ticket is the newest for the current id:
  - A reply that finishes after a withdraw does not bring back the old status.
  - A response for a previous id is never shown.
  - Of two overlapping refreshes, the newer one wins.
  - `pending` always belongs to the newest request, so a dropped response never leaves it stuck.
  - Nothing is applied after unmount.

The returned object is memoised. The action functions keep their identity across renders.

## `useCapture()`

```ts
function useCapture(): CaptureApi;

interface CaptureApi {
  start(options?: CaptureStartOptions): Promise<CaptureResult | null>; // null = cancelled
  capturing: boolean;
}
type CaptureStartOptions = Pick<
  RegionSelectOptions,
  "labels" | "zIndex" | "signal" | "screenshot" | "regionText" | "maxRegionText"
>;
```

`start()` runs `@elicitor/capture`'s `startRegionSelect` with the provider's switches:

- `screenshot` and `regionText` are on only when both the provider and the call allow them, so a
  call can switch a piece off but never on.
- `labels` are merged over `capture.labels`.
- `zIndex` and `maxRegionText` from the call override the provider's.

Only one region select runs at a time. A second `start()` (or `open()`) while `capturing` rejects
with `ElicitorActionError("busy")`. `open()` uses the same function, so `capturing` is also `true`
during the flow's `selecting` step.

## `createFetchTransport(baseUrl, options?)`

```ts
function createFetchTransport(baseUrl: string, options?: FetchTransportOptions): ElicitorTransport;

interface FetchTransportOptions {
  fetch?: typeof fetch; // default: globalThis.fetch, looked up on every request
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>); // the function runs per request
  credentials?: RequestCredentials; // left out of the request when not given
}
```

### The REST shape

The transport speaks this shape. `examples/vite-react/server.example.ts` and the handler in
[docs/quick-start.md](../../docs/quick-start.md) implement it; a ready-made `@elicitor/server` is
planned for 0.2.
`{base}` is `baseUrl` with trailing slashes removed. `:id` is `ReportListItem.id`, passed through
`encodeURIComponent`. Every request sends `Accept: application/json`, and requests with a body
send `Content-Type: application/json`.

| Method and path                    | Request body                | Success response                   |
| ---------------------------------- | --------------------------- | ---------------------------------- |
| `POST {base}/reports`              | `CreateReportInput`         | 2xx, `ReportListItem`              |
| `GET {base}/reports`               | none                        | 2xx, `ReportListItem[]`            |
| `GET {base}/reports/:id`           | none                        | 2xx, `ReportDetail`                |
| `POST {base}/reports/:id/reply`    | `{ "body": string }`        | 2xx, `ReportDetail`                |
| `POST {base}/reports/:id/confirm`  | `{ "expectedSeq": number }` | 2xx, `ReportDetail`                |
| `POST {base}/reports/:id/withdraw` | none                        | 204 (any 2xx; the body is ignored) |

The server decides authorisation, and `canReply` / `canConfirm` / `canWithdraw` in every
`ReportDetail` reflect it.

Errors. Any non-2xx response throws `ElicitorTransportError`:

```ts
class ElicitorTransportError extends Error {
  readonly status: number; // HTTP status; 0 when no response arrived
  readonly code: string | null; // from the body, or a transport code, or null
}
```

- The JSON error body is `{ "error": { "code": string, "message"?: string } }`. `code` is copied
  as is, and `message` becomes the error message.
- The codes core uses are `"not_found"` (404), `"invalid"` (400) and `"stale"` (409, confirm with an
  old `expectedSeq`). A host may add its own, for example `"forbidden"` (403).
- A body that is not JSON, or has no code, gives `code: null`.
- When `fetch` itself throws: `status: 0`, `code: "network"`, with the original error as `cause`.
- A 2xx response whose body is not JSON (where one is expected) gives `code: "invalid_response"`.

`isElicitorTransportError(error)` recognises the error across duplicate copies of this package.

## `ElicitorActionError`

```ts
type ElicitorActionErrorCode =
  | "no_report"
  | "not_allowed"
  | "no_pending_summary"
  | "busy"
  | "empty"
  | "invalid_step";
class ElicitorActionError extends Error {
  readonly code: ElicitorActionErrorCode;
}
function isElicitorActionError(error: unknown): error is ElicitorActionError;
```

A hook throws this error when it refuses an action before making any request. See the error
contract.

## `@elicitor/react/testing`

```ts
function createMemoryTransport(options?: MemoryTransportOptions): MemoryTransport;

interface MemoryTransportOptions {
  model?: ModelAdapter; // default createFakeModel(): one question, then a summary
  store?: MemoryStore; // default createMemoryStore(storeOptions)
  storeOptions?: MemoryStoreOptions;
  prompt?: string | SystemPromptOptions; // default { productDescription: "a web application" }
  owner?: boolean; // default true
  delayMs?: number; // wait before every call; default 0
}
interface MemoryTransport extends ElicitorTransport {
  actAs(owner: boolean): void;
  readonly store: MemoryStore;
  readonly intake: Intake;
}
```

An in-browser backend built from core's `createIntake`, `createFakeModel` and `createMemoryStore`,
with no server and no API key. Use it for tests, demos and UI development.

- `actAs(false)` turns the viewer into a non-owner. Details then have `canReply`, `canConfirm` and
  `canWithdraw` set to `false`, and the transport refuses `reply`, `confirm` and `withdraw` with
  `ElicitorTransportError(403, "forbidden")`.
- Core errors are mapped to the same `ElicitorTransportError` statuses and codes that a REST server
  returns (`not_found` 404, `invalid` 400, `stale` 409), so a UI handles both transports the same
  way.
- `get()` marks the report as seen.
- `store` and `intake` are exposed so a test can advance the server state past the UI, for example
  by calling `transport.reply()` directly to make a seq stale.

The default fake model answers in the context language when `@elicitor/core` has a script for it,
and in English otherwise. Its first turn is the question "What should be shown there instead?". After the next
reply it sends a summary whose `expected` field is that reply.

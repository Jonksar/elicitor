# Adapters: model, store, transport

Core has three seams. A `ModelAdapter` talks to a model provider, a `ReportStore` persists reports,
and an `ElicitorTransport` carries calls from the browser to your server. All three are plain
interfaces exported from `@elicitor/core`.

## ModelAdapter

```ts
interface ModelAdapter {
  complete(request: ModelRequest): Promise<string>;
}

interface ModelRequest {
  readonly system: string; // byte-stable for the same prompt options: mark it cacheable
  readonly messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>; // oldest first
  readonly images?: ReadonlyArray<{ png: string }>; // base64 PNG, no data: prefix
  readonly outputSchema: object; // TURN_JSON_SCHEMA
  readonly signal?: AbortSignal;
}
```

The contract:

- Return the model's raw text. Core parses it with `parseTurn`: whole-text JSON first, then the
  outermost `{...}`, and prose without any `{` becomes a question. You do not parse anything.
- Attach `images` to the **first** user message, before its text. The first message always carries
  the capture; later messages alternate assistant and user.
- Pass `outputSchema` to the provider's structured output feature when it has one. It is a plain
  JSON Schema object with `additionalProperties: false` everywhere.
- Throw `IntakeUnavailable` when there is no usable text:
  `"not_configured"` (no key or endpoint; ideally without making a request), `"gateway"` (network,
  HTTP or SDK error; pass the original as `cause`) or `"refusal"`. Any other error you throw is
  treated as `"gateway"`. `"invalid_output"` is core's own reason for text that does not decode.
- Honour `signal` when it is given. `createIntake` does not pass one today; `runTurn` accepts it.

Whatever the reason, an unavailable turn never loses the report: core appends a system note in
the reporter's language and moves it to `submitted`. `createIntake({ onUnavailable })` receives
`{ reportId, reason, cause? }`.

### Writing one

A sketch for an OpenAI-compatible chat completions endpoint. It is an illustration of the
contract, not a tested adapter:

```ts
import { IntakeUnavailable, type ModelAdapter } from "@elicitor/core";

export const chatCompletionsModel = (options: {
  url: string;
  apiKey: string;
  model: string;
}): ModelAdapter => ({
  async complete(request) {
    const [first, ...rest] = request.messages;
    const images = (request.images ?? []).map((image) => ({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${image.png}` },
    }));
    let response: Response;
    try {
      response = await fetch(options.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: [...images, { type: "text", text: first?.content ?? "" }] },
            ...rest,
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "turn", schema: request.outputSchema },
          },
        }),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (cause) {
      throw new IntakeUnavailable("gateway", { cause });
    }
    if (!response.ok) throw new IntakeUnavailable("gateway", { cause: response.status });
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; refusal?: string } }>;
    };
    const message = data.choices?.[0]?.message;
    if (message?.refusal) throw new IntakeUnavailable("refusal");
    return message?.content ?? "";
  },
});
```

`@elicitor/anthropic` ([README](../packages/anthropic/README.md)) is the maintained adapter. An
adapter for the Vercel AI SDK is planned for 0.2.

### The fake model

`createFakeModel()` from `@elicitor/core/testing` needs no key and no network:

- Without a script it is a scripted agent: one question ("What should be shown there instead?",
  or the Estonian, Finnish or Russian equivalent), then a summary built from the first sentence and
  the latest reply.
- With a script, each call consumes the next step: a `Turn` (sent as JSON), a raw string, an
  `Error` to throw, or a function of the request. A call after the last step throws.
- `requests` records every `ModelRequest` it received, for assertions.
- Options instead of a bare script: `createFakeModel({ script?, publicSummary?, record? })`.
  `publicSummary` sets the built-in agent's public summary. `record: false` keeps `requests`
  empty, so a long-lived fake (a development server) holds no memory per call.

```ts
import { createIntake, createMemoryStore } from "@elicitor/core";
import { createFakeModel } from "@elicitor/core/testing";

const model = createFakeModel([
  { kind: "question", text: "Which order?" },
  {
    kind: "summary",
    text: "The total on order 10482 is wrong. Is this right?",
    summary: {
      title: "Order total is wrong",
      kind: "figure",
      expected: "224.40",
      actual: "182.40",
      steps: ["Open the order"],
      publicSummary: "The order total does not match the sum of its lines.",
    },
  },
]);
const intake = createIntake({
  model,
  store: createMemoryStore(),
  prompt: { productDescription: "a web application" },
});
```

`unavailableModel(reason?)`, also from `@elicitor/core/testing`, is a model that always throws
`IntakeUnavailable`, for testing the fallback path or running with the assistant switched off.

## ReportStore

```ts
interface ReportStore {
  create?(input: NewReport): Promise<{ id: string; seq: number }>; // needed by intake.start only
  get(id: string): Promise<StoredReport | null>;
  loadCapture(id: string): Promise<Capture | null>;
  appendReporterMessage(
    id: string,
    body: string,
  ): Promise<{ ok: true; seq: number } | { ok: false; reason: "not_found" | "not_intake" }>;
  commitTurn(id: string, expectedSeq: number, outcome: TurnOutcome): Promise<boolean>;
  confirm(id: string, expectedSeq: number): Promise<"confirmed" | "stale" | "not_found">;
  withdraw(id: string): Promise<"withdrawn" | "not_allowed" | "not_found">;
}
```

The rules:

- **`create`** saves the report in status `intake` with the sentence as message seq 1, plus the
  capture (`language`, `route`, `regionText`, `context`, `screenshotPng`), the `region` and the
  opaque `metadata`. Returns the new id and seq `1`. Only `intake.start` calls it (and throws a
  `TypeError` without it): hosts that create rows themselves leave it out and call
  `intake.advance` (see "Running turns elsewhere").
- **`get`** returns messages ordered by seq. Agent messages carry the parsed `turn`; core rebuilds
  the model history from it.
- **`loadCapture`** returns what `create` saved; core needs it for every later turn.
- **`appendReporterMessage`** appends only while the status is `intake`, and returns the new seq.
- **`commitTurn`** writes only if the report is still `intake` **and** its latest message seq
  equals `expectedSeq`; otherwise it writes nothing and returns `false`. For
  `{ kind: "turn" }` it appends an agent message with the turn. For `{ kind: "unavailable" }` it
  appends a system message with `note` and sets status `submitted`. This drops a late model answer
  when the reporter wrote again or withdrew while the model was thinking.
- **`confirm`** succeeds only while the status is `intake` and the **latest** message is an agent
  summary whose seq equals `expectedSeq`. It sets status `submitted` and stores the summary and its
  title. Anything else that exists is `"stale"`.
- **`withdraw`** is allowed from `intake` and `submitted` only.

**Every mutating method must be atomic**: one transaction, or one conditional write. Core never does
check-then-write across calls, so a check in one query and a write in another can lose a race
between two tabs, or between a slow model call and a withdraw. Errors a store throws pass through
core unchanged (so the host can answer 503); they never trigger the unavailable fallback.

The browser-facing mapping (`ReportListItem`, `ReportDetail`, the `can*` flags, `viewerIsReporter`,
unread markers, the list query) is not part of `ReportStore`. `createMemoryStore` adds `list`, `toListItem`, `toDetail`,
`markSeen`, `setStatus` and `metadataOf` for convenience; with your own store this is host code.
`pendingSummaryOf(messages, status)` from core gives the pending summary and its seq for a
`ReportDetail`.

### A Postgres sketch

Not shipped, not tested; it shows where the atomicity goes. `last_seq` on the report row is the
compare-and-set value.

```sql
create table elicitor_reports (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  owner_id text not null,
  status text not null default 'intake',
  title text,
  summary jsonb,
  capture jsonb not null,      -- language, route, regionText, context
  screenshot_png text,         -- or object storage, keyed by id
  region jsonb,
  metadata jsonb not null default '{}',
  last_seq int not null default 1,
  created_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now()
);

create table elicitor_messages (
  report_id uuid not null references elicitor_reports (id) on delete cascade,
  seq int not null,
  author text not null,        -- reporter | agent | fixer | system
  body text not null,
  turn jsonb,
  created_at timestamptz not null default now(),
  primary key (report_id, seq)
);
```

`commitTurn` as one statement. The `UPDATE ... WHERE status = 'intake' AND last_seq = $2` is the
check and the write together; under the default isolation level a concurrent writer waits on the
row lock and the condition is evaluated again:

```ts
import type { TurnOutcome } from "@elicitor/core";

interface Db {
  query(text: string, values: ReadonlyArray<unknown>): Promise<{ rowCount: number | null }>;
}

export const commitTurn = async (
  db: Db,
  id: string,
  expectedSeq: number,
  outcome: TurnOutcome,
): Promise<boolean> => {
  const unavailable = outcome.kind === "unavailable";
  const result = await db.query(
    `with bumped as (
       update elicitor_reports
          set last_seq = last_seq + 1,
              status = case when $3 then 'submitted' else status end,
              status_changed_at = case when $3 then now() else status_changed_at end
        where id = $1 and status = 'intake' and last_seq = $2
       returning id, last_seq
     )
     insert into elicitor_messages (report_id, seq, author, body, turn)
     select id, last_seq, $4, $5, $6 from bumped`,
    [
      id,
      expectedSeq,
      unavailable,
      unavailable ? "system" : "agent",
      outcome.kind === "turn" ? outcome.turn.text : outcome.note,
      outcome.kind === "turn" ? JSON.stringify(outcome.turn) : null,
    ],
  );
  return result.rowCount === 1;
};
```

`confirm` in the same style:

```sql
update elicitor_reports r
   set status = 'submitted',
       status_changed_at = now(),
       summary = m.turn -> 'summary',
       title = left(m.turn -> 'summary' ->> 'title', 200)
  from elicitor_messages m
 where r.id = $1 and r.status = 'intake' and r.last_seq = $2
   and m.report_id = r.id and m.seq = $2
   and m.author = 'agent' and m.turn ->> 'kind' = 'summary'
returning r.id;
-- no row: "stale" if the report exists, else "not_found"
```

`appendReporterMessage` is the `commitTurn` statement without the `last_seq` condition and with
author `reporter`; `withdraw` is
`update elicitor_reports set status = 'withdrawn', status_changed_at = now() where id = $1 and status in ('intake', 'submitted')`.
A follow-up `select` after a write that matched no row only decides which refusal to return, so it
does not need to be atomic with the write.

### Running turns elsewhere

`intake.start` and `intake.reply` run the model turn before they resolve. A host that creates the
report row itself (for example in its own transaction) can call
`intake.advance(id, expectedSeq, capture)` to run the turn that answers message `expectedSeq`; the
same `commitTurn` rule drops it if the report moved on. Such a store needs no `create`.

`start`, `reply` and `advance` take `{ signal }` as their last argument. It is passed to the model
call. When it is aborted (the client went away, the request was cancelled), the call rejects with
the signal's reason and commits nothing: a reply already saved stays saved, the report stays in
`intake`, and the submit-as-written fallback does not run.

## Transports

The browser half only needs an `ElicitorTransport`:

```ts
interface ElicitorTransport {
  create(input: CreateReportInput): Promise<ReportListItem>;
  list(): Promise<ReadonlyArray<ReportListItem>>;
  get(id: string): Promise<ReportDetail>;
  reply(id: string, body: string): Promise<ReportDetail>;
  confirm(id: string, expectedSeq: number): Promise<ReportDetail>;
  withdraw(id: string): Promise<void>;
}
```

### Fetch

`createFetchTransport(baseUrl, { fetch?, headers?, credentials? })` from `@elicitor/react` (also
re-exported by `@elicitor/react-ui`) speaks the REST shape documented in
[`packages/react/README.md`](../packages/react/README.md#the-rest-shape). Failures throw
`ElicitorTransportError` with `status` and `code`.

### Custom

Anything that can reach your server works: tRPC, GraphQL, a WebSocket, an Electron IPC bridge.
Throw `ElicitorTransportError` (from `@elicitor/react`, or `@elicitor/react-ui`, which re-exports
it) with the codes the UI understands, so a stale confirm shows "The summary has changed" instead of
a generic error:

```ts
import type { ElicitorTransport } from "@elicitor/core";
import { ElicitorTransportError } from "@elicitor/react";

type Call = (method: string, args: ReadonlyArray<unknown>) => Promise<unknown>;

export const rpcTransport = (call: Call): ElicitorTransport => {
  const send = async <T>(method: string, ...args: ReadonlyArray<unknown>): Promise<T> => {
    try {
      return (await call(method, args)) as T;
    } catch (error) {
      const code = (error as { code?: string }).code ?? null;
      const status = code === "not_found" ? 404 : code === "stale" ? 409 : 500;
      throw new ElicitorTransportError(status, code, undefined, { cause: error });
    }
  };
  return {
    create: (input) => send("elicitor.create", input),
    list: () => send("elicitor.list"),
    get: (id) => send("elicitor.get", id),
    reply: (id, body) => send("elicitor.reply", id, body),
    confirm: (id, expectedSeq) => send("elicitor.confirm", id, expectedSeq),
    withdraw: (id) => send("elicitor.withdraw", id),
  };
};
```

The codes the UI reads: `"stale"` on confirm, `"not_found"` on get. Everything else is shown as a
generic failure.

### Memory

`createMemoryTransport(options?)` from `@elicitor/react/testing` runs `createIntake`,
`createFakeModel()` and `createMemoryStore()` in the browser. Options: `model`, `store`,
`storeOptions`, `prompt`, `owner` (default `true`), `delayMs`. `actAs(false)` makes the viewer a
non-owner, and `store` and `intake` are exposed so a test can change server state behind the UI.
Errors map to the same statuses and codes the REST shape uses. For tests, demos and UI work only.

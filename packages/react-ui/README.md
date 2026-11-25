# @elicitor/react-ui

The ready-made Elicitor widget for React: a floating "Report a problem" button, the region select,
a one-sentence dialog and a thread panel where the assistant asks its follow-up questions and reads
back a summary for the reporter to confirm. Plain React and one CSS file; no UI library, no
CSS-in-JS. Built on the headless [`@elicitor/react`](../react/README.md); everything it exports
(provider, hooks, `createFetchTransport`, `ElicitorTransportError` and the other errors, the wire
types a custom transport needs) is re-exported here, so a host imports from this package only.

```tsx
import "@elicitor/react-ui/styles.css";
import { createFetchTransport, Elicitor, ElicitorProvider } from "@elicitor/react-ui";

const transport = createFetchTransport("/api/elicitor");

export function App() {
  return (
    <ElicitorProvider transport={transport} locale="en">
      <YourApp />
      <Elicitor />
    </ElicitorProvider>
  );
}
```

Try it without a backend: `pnpm dev` at the repository root runs `examples/vite-react` with an
in-browser fake model (`createMemoryTransport` from `@elicitor/react/testing`).

## Components

### `<Elicitor />`

| Prop                    | Type                                                                         | Default          |
| ----------------------- | ---------------------------------------------------------------------------- | ---------------- |
| `trigger`               | `ReactNode \| ((api: { open(): void; busy: boolean }) => ReactNode) \| null` | floating button  |
| `position`              | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"`               | `"bottom-right"` |
| `colorScheme`           | `"light" \| "dark" \| "system"`                                              | `"system"`       |
| `className`             | `string`                                                                     |                  |
| `onSubmitted`           | `(report: ReportListItem) => void`                                           |                  |
| `openThreadAfterSubmit` | `boolean`                                                                    | `true`           |

- `trigger` as a node replaces the floating button's content. As a function it renders your own
  trigger in place, without the floating wrapper. `null` renders no trigger: open the widget from
  your own menu with `useElicitor().open({ labels: useMessages().overlayLabels })` (without
  `labels` the overlay texts are English).
- The flow: region select → one sentence → thread panel with questions, replies, the summary
  read-back, confirm and the "sent" state. Escape closes the dialog and the panel; focus returns
  to the element that opened them.
- The default trigger is disabled (and the render prop's `busy` is true) while the region select
  runs and while the report is being sent. Focus still goes back to it afterwards.
- `onSubmitted` gets the new report once it was sent. With `openThreadAfterSubmit={false}` the
  widget closes instead of opening the thread panel (no report request is made), so the host can
  show the report on its own page, for example by navigating there from `onSubmitted`.

### `<ReportThread reportId showScreenshot? header? renderError? colorScheme? className? />`

One report: its messages (a `role="log"` live region), the reply box, the pending summary with
confirm, and withdraw. The reporter's messages are labelled "You" when `report.viewerIsReporter`
(decided by the host) and "Reporter" otherwise.

- `showScreenshot` shows `report.screenshotPng` under the title (alt text: the `reportScreenshot`
  key).
- `header`: a node shown at the top of the thread, or a function of the loaded report.
- `renderError(error, retry)`: your own message for a failed load, for example for a transport
  error with `code === "unavailable"`. Return `null` or `undefined` to keep the default notice.
- The pending summary card is shown from `report.pendingSummary` even when the host returns no
  message with `pendingSummarySeq`; it then follows the log.

### `<SummaryConfirm report onConfirm? onCorrect? busy? />`

The structured summary (title, kind, what is shown now, what it should be, steps): the pending one
while the report is in intake, else the confirmed one. Confirm appears only while a summary is
pending and `report.canConfirm`; the "correct it" button only with `onCorrect` and
`report.canReply`. There is no field editing: a correction is a reply in the thread, and the
assistant answers it with a new summary. Only the latest summary can be confirmed.

### `<ReportList onSelect? getHref? renderRow? renderError? selectedId? colorScheme? className? />`

The reporter's own reports, newest first: status label, unread marker, title (or the first
sentence), number and date. Loads on mount. A row opened from the list stops showing as unread.

- With `onSelect` alone, rows are buttons.
- With `getHref(item)`, rows are links (`<a href>`). A plain click calls `onSelect` and, when
  `onSelect` is given, prevents the browser's navigation so a client-side router can navigate; a
  modified or middle click (new tab, new window) is left to the browser.
- `renderRow(item, row)` replaces the row element; `row` has `unread`, `selected`, `href`,
  `select()` and the default `content`.
- `renderError(error, retry)` as on `ReportThread`, for a failed list load.

### Ownership

Reply, confirm and withdraw controls follow `canReply`, `canConfirm` and `canWithdraw` from the
report strictly: when a flag is false the control is not rendered at all. The host backend decides.

## Texts

Bundles for English, Estonian, Finnish and Russian. The provider's `locale` picks one (`"et-EE"`
→ `"et"`, anything else unknown → `"en"`); its `messages` prop replaces single keys:

```tsx
<ElicitorProvider transport={transport} locale="et" messages={{ report: "Leidsid vea?" }}>
```

Exports: `bundles`, `resolveMessages(locale, overrides)`, `normalizeLocale`, `formatMessage`
(`{placeholder}` interpolation), the types `Messages`, `MessageKey`, `Locale`, `MessageOverrides`,
and `useMessages()` (`t(key, values?)`, `status(status)`, `kind(kind)`, `date(iso)` through
`Intl.DateTimeFormat`, and `overlayLabels` for the region select).

## Styling

Import `@elicitor/react-ui/styles.css` once. Every rule is scoped under `.elicitor`, the class every
root carries. The `<Elicitor />` widget's own roots (trigger, dialogs, thread panel) also carry
`data-elicitor-ui`, which keeps them out of screenshots and region text; `ReportThread`,
`ReportList` and `SummaryConfirm` rendered by your page do not, so a report filed from that page
captures it like any other content. Theme it with CSS variables on `:root` or any ancestor; they
win over the built-in light and dark values:

`--elicitor-fg`, `--elicitor-bg`, `--elicitor-muted`, `--elicitor-border`, `--elicitor-accent`,
`--elicitor-accent-fg`, `--elicitor-danger`, `--elicitor-radius`, `--elicitor-font`,
`--elicitor-shadow`, `--elicitor-z`, `--elicitor-overlay`.

`colorScheme="system"` follows `prefers-color-scheme`; `"light"` and `"dark"` force one through the
`data-elicitor-scheme` attribute. The region-select overlay of `@elicitor/capture` takes the same
tokens and follows the system scheme. Motion is off under `prefers-reduced-motion`.

# Privacy: what Elicitor collects

Elicitor runs inside your application and sends to your backend. It has no server of its own, no
analytics and no telemetry. Everything below goes from the reporter's browser to the transport you
configured, and from your server to the model provider you configured.

## When collection happens

- **Console errors** are the one thing recorded before the widget opens. With
  `capture.consoleErrors` on (the default), `<ElicitorProvider>` installs a buffer after mount that
  keeps the latest 30 `console.error` calls, window `error` events and `unhandledrejection` reasons
  in memory. Nothing leaves the page until a report is created. With a function instead, your own
  buffer is read when the region select finishes and the provider installs nothing.
- **Route, context and metadata** are read when the region select finishes, before the reporter
  types the sentence (`createReport()` reads them when it is called).
- **Screenshot and region text** are taken when the reporter has chosen a region or the whole view,
  after the overlay is removed.
- Nothing is sent until the reporter presses Send. Cancelling the region select or closing the
  dialog discards the capture.

## Fields sent with a new report

The body of `POST {base}/reports` (`CreateReportInput`), as `@elicitor/react` builds it:

| Field                   | Content                                                                                       | Cap                                                                              | How to switch it off                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `sentence`              | What the reporter typed, trimmed                                                              | none in the client                                                               | required                                                                              |
| `route`                 | `getRoute()`; default `location.pathname + location.search` (the query string is included)    | none                                                                             | pass a `getRoute` that returns a cleaned route                                        |
| `region`                | The marked rectangle and viewport size in CSS pixels; left out for "whole view"               | 6 numbers                                                                        | not switchable while a region is marked                                               |
| `screenshotPng`         | Base64 PNG of the **whole visible viewport**, with the marked region outlined in red          | one image at `min(devicePixelRatio, 2)` scale; no byte limit                     | `capture: { screenshot: false }` (sends `""`, the screenshot library is never loaded) |
| `regionText`            | Rendered text (`innerText`) of leaf elements that intersect the region, or the whole viewport | 200 unique entries (`capture.maxRegionText`), each cut to 500 characters         | `capture: { regionText: false }` (sends `[]`)                                         |
| `context.language`      | The provider's `locale`                                                                       | one tag                                                                          | not switchable (it picks the assistant's language)                                    |
| `context.viewport`      | `innerWidth`, `innerHeight`                                                                   | 2 numbers                                                                        | not switchable                                                                        |
| `context.userAgent`     | `navigator.userAgent`                                                                         | one string                                                                       | `capture: { userAgent: false }` (sends `""`)                                          |
| `context.bundleId`      | `capture.bundleId`                                                                            | as given; `""` by default                                                        | leave it out                                                                          |
| `context.requestLog`    | Entries your code pushed into a `createRequestLog()` passed as `capture.requestLog`           | latest 50 (`createRequestLog(limit)`); a function you pass instead is not capped | leave `capture.requestLog` out (sends `[]`)                                           |
| `context.consoleErrors` | First argument of each `console.error`, window errors, unhandled rejections, with timestamps  | latest 30; `message` and `stack` cut to 2000 characters each                     | `capture: { consoleErrors: false }` (no buffer is installed; sends `[]`)              |
| `metadata`              | Whatever `getMetadata()` returns                                                              | none                                                                             | leave `getMetadata` out (the key is omitted)                                          |

Later requests send only the reporter's replies (`{ "body": string }`), the confirmed summary's
sequence number, or nothing (withdraw).

The caps are applied in the browser. A modified client can send anything, so the server must
enforce its own limits ([security.md](security.md)).

The `capture` option is read each time a capture starts, so it can differ per route, for example
`capture={{ screenshot: !isPaymentPage }}`.

### Details that matter in a review

- **The screenshot is not cropped.** A marked region is drawn as a red rectangle on the full
  viewport picture. Content scrolled out of view is not in it. Form field values are drawn as they
  appear on screen.
- **Region text** includes only rendered text: text hidden with CSS is skipped, and `<input>`
  values are not read (inputs have no rendered text). It can still contain any personal data
  shown on screen.
- **The request log** is written only by your code. Elicitor never observes network traffic. Call
  `clear()` on it when the signed-in user changes.
- **Console errors** can contain whatever your code or libraries log, including URLs, ids and
  response bodies. Switch them off if your logs carry personal data.

## Keeping parts of the page out

Any element with the `data-elicitor-ui` attribute, and everything inside it, is left out of both
the screenshot and the region text. The `<Elicitor />` widget sets it on its own roots (trigger,
dialogs, thread panel) and the overlay sets it on itself. `ReportList`, `ReportThread` and
`SummaryConfirm` rendered by your own page are not marked: a report filed from that page captures
them like the rest of it. A trigger you render yourself (`trigger={(api) => ...}` or your own menu
item) is not marked either; add the attribute if it should stay out of the picture. Use it on your
own sensitive UI:

```html
<section data-elicitor-ui>
  <!-- card details, personal ids, private messages -->
</section>
```

Guidance for masking:

- Mark the smallest container that holds the sensitive data, and check a real capture: an excluded
  element is not drawn, so the picture shows the page without it.
- Prefer turning the screenshot off on screens that are sensitive as a whole (payment, identity
  documents, health data) over marking many elements.
- Text the reporter types into the sentence or a reply is never filtered. The system prompt does
  not ask for personal data, and you can add a rule with `prompt.extraRules` (for example "Never ask
  for a password or a bank account number."), but a reporter can still type anything.

## What the model provider receives

On every turn, core builds one request (`buildModelRequest`) and the adapter sends it to the
provider (with `@elicitor/anthropic`: the Anthropic API, or the gateway at `baseURL`):

- the system prompt (built from your `prompt` options; no report data);
- a first user message with the reporter's language name, the route, the first 200 region text
  entries, the `context` JSON cut to its first 20 000 characters, and the opening sentence;
- the conversation so far: the assistant's questions and summaries, the reporter's replies;
- the screenshot, attached to that first message, when it is not empty. It is sent again on every
  turn, because each request carries the whole conversation.

Not sent to the model: `metadata`, the region coordinates, report ids, message timestamps (the
timestamps inside `context.requestLog` and `context.consoleErrors` are part of the context JSON and
are sent), and the system
notes core appends. The provider's own retention and training terms apply to what is sent; check
them for the provider and account you use.

## What comes back to the browser

`ReportDetail` (from `MemoryStore.toDetail`, or your own mapping) contains the route, the region,
all messages including system notes, the summaries and the screenshot. Return
`screenshotPng: null` if the browser should not get the picture back.

## The public summary

Each summary has a `publicSummary` field: one or two English sentences meant for a public issue
tracker. The system prompt tells the model it must contain no customer data (no amounts or other
numbers, names, dates or document numbers; see `DEFAULT_PUBLIC_SUMMARY_RULES` in
`@elicitor/core/engine`, which
`prompt.publicSummaryRules` replaces). It is still model output. Treat it as a draft that usually
has no customer data, not as a guarantee: review it, or filter it, before it leaves your systems.

## What the host owns

Core stores nothing by itself. Your `ReportStore` decides where reports, screenshots and messages
live, how they are encrypted, how long they are kept, who can read them and how a reporter's data
is deleted on request. `createMemoryStore` keeps everything in process memory and is meant for
tests and development only.

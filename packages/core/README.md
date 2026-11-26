# @elicitor/core

The intake engine behind Elicitor: it runs the short conversation that turns a reporter's one
sentence into a reproducible bug report, then waits for the reporter to confirm the summary. No
runtime dependencies, no I/O of its own. It runs on a server (or, for tests and demos, in the
browser) over a model adapter and a store you provide.

```sh
pnpm add @elicitor/core
```

```ts
import { createIntake, createMemoryStore } from "@elicitor/core";
import { anthropicModel } from "@elicitor/anthropic";

const intake = createIntake({
  model: anthropicModel(),
  store: createMemoryStore(),
  prompt: { productDescription: "Acme Books, an online bookkeeping application" },
});
```

## Exports

Three entry points. Most hosts need only the first.

### `@elicitor/core`

- `createIntake(options)`: `start`, `reply`, `advance`, `confirm`, `withdraw`. Options: `model`,
  `store`, `prompt` (a string or `SystemPromptOptions`), `maxQuestions` (default 4),
  `languages`, `defaultLanguage`, `unavailableNotes`, `onUnavailable`. `start`, `reply` and
  `advance` take `{ signal }` last; an aborted signal rejects without committing anything or
  running the fallback. `start` needs `store.create`; hosts that create rows themselves call
  `advance`.
- `buildSystemPrompt(options)`: the system prompt as a string, when you want to store or inspect
  it; `createIntake` builds it for you from `prompt`.
- `createMemoryStore()`: a complete `ReportStore` in memory, plus the list and detail mapping a
  server needs. For development, demos and tests; reports are lost on restart.
  `pendingSummaryOf(messages, status)` gives the pending summary and its seq when you build a
  `ReportDetail` over your own store.
- Defaults to extend: `DEFAULT_LANGUAGES`, `DEFAULT_UNAVAILABLE_NOTES`, `MAX_QUESTIONS` (4).
- Errors: `IntakeUnavailable` / `isIntakeUnavailable` (the model gave no usable turn; core then
  submits the report as written) and `ElicitorError` / `isElicitorError` (`not_found`, `invalid`,
  `stale`). The `is*` guards work across duplicate copies of the package.
- Types: the report data (`Summary`, `Turn`, `Region`, `CaptureContext`, ...), the `ModelAdapter`
  and `ReportStore` contracts, and the wire types the browser exchanges with your server
  (`ElicitorTransport`, `CreateReportInput`, `ReportListItem`, `ReportDetail`).

### `@elicitor/core/testing`

Model doubles that need no key and no network: `createFakeModel` (a script, or
`{ script?, publicSummary?, record? }`) and `unavailableModel`.

### `@elicitor/core/engine`

The stateless pieces `createIntake` is made of, for hosts that run turns themselves and for adapter
authors: `runTurn`, `buildModelRequest`, `parseTurn`, `isTurn`, `isSummary`, `countQuestions`,
`resolveLanguage`, `TURN_JSON_SCHEMA`, and the constants `MAX_CONTEXT_CHARS` (20 000),
`MAX_REGION_TEXT_ENTRIES` (200), `DEFAULT_LANGUAGE`, `QUESTION_LIMIT_NOTE`, `REPORTER_WROTE`,
`DEFAULT_GLOSSARY_HEADING`, `DEFAULT_REPRODUCIBLE_WHEN`, `DEFAULT_PUBLIC_SUMMARY_RULES`. This entry
changes more freely than the main one before 1.0.

Authorisation is the host's concern: core acts on any report id it is given.

## Documentation

- [Quick start](../../docs/quick-start.md)
- [Adapters: ModelAdapter, ReportStore, transports](../../docs/adapters.md)
- [Privacy](../../docs/privacy.md) and [security notes](../../docs/security.md)

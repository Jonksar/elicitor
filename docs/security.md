# Security notes

Elicitor's packages are libraries. Your server is the security boundary: core acts on any report
id it is given and trusts the input it is handed. These are the things the host has to do.

To report a vulnerability in Elicitor itself, see [SECURITY.md](../SECURITY.md).

## Authorise every call

- Identify the user from your session on every request, never from the request body or from
  `metadata` the browser sent. Set the owner on the server when the report is created.
- Check ownership (or your own roles) before `get`, `reply`, `confirm` and `withdraw`, and filter
  `list` to the reports the user may see. Answer 404 rather than 403 if report ids should not be
  probeable.
- Compute `canReply`, `canConfirm` and `canWithdraw` on the server. With `createMemoryStore`, pass
  your decision as `toDetail(id, { canAct })`; with your own store, set the flags yourself. The UI
  hides controls when a flag is false, but that is presentation only: the server must refuse the
  action as well.
- The fetch transport leaves `credentials` to the `fetch` default (`same-origin`), so cookies go
  with every request to a same-origin `baseUrl`; pass `credentials: "include"` for another origin.
  If you authenticate with cookies, use your usual CSRF protection: `headers` can be a function
  that adds a token per request.

## Validate input on the server

Core checks that the sentence and replies are not empty after trimming. It does not check sizes,
types or formats. Before calling `intake.start` or `intake.reply`, enforce your own limits, for
example:

- `screenshotPng`: a maximum decoded size, valid base64, and the PNG signature
  (`89 50 4E 47 0D 0A 1A 0A`) at the start of the decoded bytes. Reject or drop anything else.
- `sentence` and reply `body`: a maximum length.
- `regionText`: an array of strings, at most 200 entries of at most 500 characters (what the client
  sends by default).
- `context`: the `CaptureContext` shape, with `requestLog` at most 50 and `consoleErrors` at most 30
  entries, and a maximum serialised size. Core cuts the context JSON to 20 000 characters for the
  model, but stores what it is given.
- `region`: six finite numbers.
- `metadata`: only the keys you expect.
- A body size limit on the whole request, set in your server or proxy.

Treat everything in a report as untrusted user content wherever you display it later (an admin
view, a tracker, an e-mail): it is text the reporter typed or text that was on their screen.

## Prompt injection

The page text in `regionText`, the console errors, the route and the reporter's own messages all
reach the model, and any of them can contain instructions aimed at it. What limits the effect:

- The model has no tools. The adapters send no tool definitions, and nothing the model returns is
  executed or fetched.
- The reply is parsed against a fixed schema (`TURN_JSON_SCHEMA`, decoded by `parseTurn`): either a
  question with text, or a summary with title, kind, expected, actual, steps and public summary.
  Extra fields are dropped. Output that does not decode ends the intake with the report submitted
  as written. Plain prose with no JSON object is kept as a question.
- The UI renders every model string as text, never as HTML or Markdown.
- After `maxQuestions` questions a further question is rejected, so the conversation ends.

What it does not prevent: a manipulated model can write misleading questions or a misleading
summary, and the reporter is the one who confirms it. Anyone who reads reports downstream should
treat summaries as claims, not facts, and `publicSummary` as unreviewed text
([privacy.md](privacy.md#the-public-summary)).

## Keep the provider key on the server

`@elicitor/anthropic` and any other `ModelAdapter` belong on the server. Never bundle a provider
API key into browser code and never call the model provider from the browser.
`createMemoryTransport` runs the fake model in the browser; do not combine it with a real adapter
outside local experiments.

## Limit creation

Each new report and each reply costs a model call (and one more call per question). Rate-limit
`POST /reports` and replies per user and per IP, cap the number of open reports per user, and
consider `maxQuestions` lower than the default of 4. Withdrawn and abandoned intakes do not call the
model again.

## Gateways

A gateway between your server and the provider (`anthropicModel({ baseURL, defaultHeaders })`) is a
good place for spend limits, logging policy, key rotation and provider routing. The adapter sends
the gateway's own auth header from `defaultHeaders`; keep that secret on the server as well. If the
gateway logs request bodies, those logs contain screenshots and page text: apply the same retention
rules as for reports.

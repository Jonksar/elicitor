# @elicitor/anthropic

Anthropic Messages API model adapter for `@elicitor/core`. It asks for structured JSON output
(`output_config.format: json_schema`), uses adaptive thinking, marks the system prompt cacheable and
attaches the screenshot to the first user message. It returns the model's raw text; core parses it.

## Install

```sh
pnpm add @elicitor/core @elicitor/anthropic @anthropic-ai/sdk
```

`@anthropic-ai/sdk` (>= 1.8.0 < 2) is a peer dependency.

## Direct API key

```ts
import { createIntake, createMemoryStore } from "@elicitor/core";
import { anthropicModel } from "@elicitor/anthropic";

const intake = createIntake({
  model: anthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY }),
  store: createMemoryStore(),
  prompt: { productDescription: "Acme Books, an online bookkeeping application" },
});
```

Without `apiKey` and `baseURL` the adapter reads `ANTHROPIC_API_KEY`. With no client, key, base URL or environment
key, every turn throws `IntakeUnavailable("not_configured")` without a request, and core submits the
report as the reporter wrote it.

## Through a gateway

A gateway is a `baseURL` plus whatever headers it authenticates with:

```ts
anthropicModel({
  baseURL: "https://gateway.example/anthropic",
  defaultHeaders: { "x-gateway-key": process.env.GATEWAY_KEY ?? "" },
});
```

With a `baseURL` the adapter never reads `ANTHROPIC_API_KEY`, so a real key set in the environment
for something else is not sent to the gateway by accident. When no `apiKey` is given, the adapter
passes a placeholder key so the SDK constructs. SDK 1.8 sends it as
`Authorization: Bearer gateway-auth-by-headers`; an `Authorization` header in `defaultHeaders` (for
example basic auth) replaces it. When the gateway expects a specific value there, pass it as
`apiKey`.

## Options

| Option           | Default             |                                                                           |
| ---------------- | ------------------- | ------------------------------------------------------------------------- |
| `client`         | built on first call | A ready `Anthropic` client; the connection options below are then unused. |
| `apiKey`         | `ANTHROPIC_API_KEY` | The environment is read only without `baseURL`.                           |
| `baseURL`        | SDK default         |                                                                           |
| `defaultHeaders` | none                | Sent with every request.                                                  |
| `model`          | `"claude-opus-5-5"` |                                                                           |
| `effort`         | `"low"`             | `output_config.effort`: `"low"`, `"medium"` or `"high"`.                  |
| `thinking`       | `"adaptive"`        | `"off"` omits the `thinking` field.                                       |
| `maxTokens`      | `4000`              |                                                                           |
| `timeoutMs`      | `60000`             |                                                                           |
| `maxRetries`     | `2`                 |                                                                           |

Errors: any SDK or network error (including an aborted request) becomes
`IntakeUnavailable("gateway")` with the SDK error as `cause`; `stop_reason: "refusal"` becomes
`IntakeUnavailable("refusal")`.

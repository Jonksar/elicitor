# Quick start

Elicitor has two halves. The browser half (`@elicitor/react-ui`) captures the screen and runs the
conversation UI. The server half (`@elicitor/core` plus a model adapter) stores reports and calls
the model. They talk over a small REST shape, or any transport you write.

## 1. Install

```sh
pnpm add @elicitor/react-ui                                     # browser
pnpm add @elicitor/core @elicitor/anthropic @anthropic-ai/sdk   # server
```

`@elicitor/react-ui` depends on `@elicitor/react`, `@elicitor/capture` and `@elicitor/core`; you do
not install them separately unless you import from them. Peer dependencies: `react` and `react-dom`
`>=18` (tested on 19), `@anthropic-ai/sdk` `>=1.8.0 <2`. Node 20 or later on the server.

## 2. Client

```tsx
import "@elicitor/react-ui/styles.css";
import { createFetchTransport, Elicitor, ElicitorProvider } from "@elicitor/react-ui";
import type { ReactNode } from "react";

const transport = createFetchTransport("/api/elicitor");

export function App({ children }: { children: ReactNode }) {
  return (
    <ElicitorProvider transport={transport} locale="en">
      {children}
      <Elicitor />
    </ElicitorProvider>
  );
}
```

- Import the CSS once. Vite and Next.js type CSS imports already; with plain `tsc` add
  `declare module "*.css";` to a `.d.ts` file.
- `locale` picks the UI bundle and the language the assistant writes in
  ([i18n.md](i18n.md)).
- If your API needs cookies or headers:
  `createFetchTransport("/api/elicitor", { credentials: "include", headers: () => ({ "X-CSRF-Token": token }) })`.
  The `headers` function runs before every request.
- `getMetadata={() => ({ workspaceId })}` sends host state along with each new report. Core stores
  it and never reads it; the model never sees it.

## 3. Server

`createIntake` runs the conversation over a `ModelAdapter` and a `ReportStore`. The handler below
serves the REST shape from
[`packages/react/README.md`](../packages/react/README.md#the-rest-shape) over a Fetch API
`Request`, so it works in any framework that hands you one (route handlers, Hono, Bun, Deno, or
Node through an adapter). `examples/vite-react/server.example.ts` is the same thing on Node's `http`
module.

```ts
import { anthropicModel } from "@elicitor/anthropic";
import {
  type CreateReportInput,
  createIntake,
  createMemoryStore,
  isElicitorError,
} from "@elicitor/core";

// In memory: reports are lost on restart. Replace with your own ReportStore (adapters.md).
const store = createMemoryStore();

const intake = createIntake({
  model: anthropicModel(), // reads ANTHROPIC_API_KEY
  store,
  prompt: { productDescription: "Acme Books, an online bookkeeping application" },
});

const STATUS: Readonly<Record<string, number>> = { not_found: 404, invalid: 400, stale: 409 };

const json = (status: number, body: unknown): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const notFound = (): Response => json(404, { error: { code: "not_found" } });

/** `userId` comes from your own session, never from the request body. */
export async function handleElicitor(request: Request, userId: string): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/api\/elicitor/, "");
  const [, resource, rawId, action] = path.split("/");
  if (resource !== "reports") return notFound();
  try {
    if (rawId === undefined) {
      if (request.method === "GET")
        return json(
          200,
          store.list((metadata) => metadata.userId === userId),
        );
      if (request.method !== "POST") return notFound();
      // Validate sizes and shapes here before trusting the body (security.md).
      const input = (await request.json()) as CreateReportInput;
      const { id } = await intake.start({
        ...input,
        language: input.context.language,
        screenshotPng: input.screenshotPng || null,
        metadata: { ...input.metadata, userId }, // the owner is set by the server
      });
      return json(201, store.toListItem(id));
    }

    const id = decodeURIComponent(rawId);
    // Authorisation: only the reporter may see or act on a report.
    if (store.metadataOf(id)?.userId !== userId) return notFound();

    if (action === undefined && request.method === "GET") {
      store.markSeen(id);
      return json(200, store.toDetail(id, { canAct: true }));
    }
    if (request.method !== "POST") return notFound();
    if (action === "reply") {
      const { body } = (await request.json()) as { body: string };
      await intake.reply(id, String(body));
    } else if (action === "confirm") {
      const { expectedSeq } = (await request.json()) as { expectedSeq: number };
      await intake.confirm(id, Number(expectedSeq));
    } else if (action === "withdraw") {
      await intake.withdraw(id);
      return json(204, null);
    } else return notFound();
    return json(200, store.toDetail(id, { canAct: true }));
  } catch (error) {
    const code = isElicitorError(error) ? error.code : "internal";
    return json(STATUS[code] ?? 500, { error: { code } });
  }
}
```

What the calls do:

- `intake.start(input)` creates the report (status `intake`, the sentence as message 1) and runs
  the first model turn before it resolves. `intake.reply` saves the reply and runs the next turn.
  Both take as long as one model call.
- A turn ends with a question, a summary to confirm, or, when the model is unavailable or returns
  something unusable, a system note and status `submitted`. The report is never lost because the
  model failed. `onUnavailable` in `createIntake` tells you when that happens.
- `intake.confirm(id, expectedSeq)` accepts the pending summary; it throws `ElicitorError("stale")`
  when the reporter has written again since (HTTP 409 in the REST shape).
- The `ReportDetail` the browser receives is built by `store.toDetail`. `canAct` is your
  authorisation decision and drives `canReply`, `canConfirm` and `canWithdraw`.
  `viewerIsReporter` (default: `canAct`) says whether the viewer filed the report; the thread
  labels the reporter's messages "You" or "Reporter" from it.

### The prompt

`prompt` is either a full system prompt string or `SystemPromptOptions`:

```ts
createIntake({
  model,
  store,
  prompt: {
    productDescription: "Acme Books, an online bookkeeping application",
    audience: "a bookkeeper, not a developer",
    screenGlossary: { "/invoices": "Sales invoices list" },
    extraRules: ["Never ask for a password or a bank account number."],
  },
  maxQuestions: 3, // default 4; summaries do not count
});
```

`buildSystemPrompt(options)` returns the exact string the model gets. It is deterministic, so the
provider can cache it. The glossary is introduced by "Short screen glossary (route: label):";
`glossaryHeading` replaces that line when your labels follow another pattern.

### The model

`anthropicModel()` reads `ANTHROPIC_API_KEY` (only without a gateway `baseURL`). Options (`model`, `effort`, `thinking`, gateway
`baseURL` and `defaultHeaders`, timeouts) are in
[`packages/anthropic/README.md`](../packages/anthropic/README.md). For another provider, write a
`ModelAdapter` ([adapters.md](adapters.md)); it is one method.

## 4. Develop without a server

`createMemoryTransport()` from `@elicitor/react/testing` runs core, a scripted fake model and an
in-memory store in the browser:

```tsx
import { createMemoryTransport } from "@elicitor/react/testing";

const transport = createMemoryTransport({ delayMs: 300 });
// <ElicitorProvider transport={transport}> ... as above
```

The fake model asks one question ("What should be shown there instead?") and then reads back a
summary. `transport.actAs(false)` shows the UI a non-owner sees. This is what `pnpm dev` in this
repository runs.

## Next

- Choose what is captured: [privacy.md](privacy.md).
- Before production: [security.md](security.md).
- Your own database, model or transport: [adapters.md](adapters.md).
- Colours and fonts: [theming.md](theming.md). Texts: [i18n.md](i18n.md).

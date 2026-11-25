# Elicitor demo (Vite + React)

A small order page with a wrong total, the `<Elicitor />` widget and a "my reports" panel. It runs
entirely in the browser: `createMemoryTransport()` from `@elicitor/react/testing` combines a
scripted fake model with an in-memory store, so no server and no API key are needed.

```sh
pnpm install
pnpm dev   # from the repository root
```

The top bar switches the language (en, et, fi, ru), the colour scheme, and whether you act as the
reports' owner (a non-owner sees the thread without reply, confirm or withdraw).

`server.example.ts` is not used by the demo. It shows the real backend in a few lines: Node's
`http` module serving the REST shape that `createFetchTransport` speaks, with `createIntake`,
`anthropicModel()` and `createMemoryStore()`.

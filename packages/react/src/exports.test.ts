import { expect, test } from "vitest";

// The public surface. A change here is a change to the package's interface: update the README,
// the changeset and this list together.
test("runtime exports of index.ts", async () => {
  expect(Object.keys(await import("./index.ts")).sort()).toMatchInlineSnapshot(`
    [
      "CONSOLE_ERROR_LIMIT",
      "ElicitorActionError",
      "ElicitorProvider",
      "ElicitorTransportError",
      "createFetchTransport",
      "isElicitorActionError",
      "isElicitorTransportError",
      "useCapture",
      "useElicitor",
      "useReport",
    ]
  `);
});
test("runtime exports of testing.ts", async () => {
  expect(Object.keys(await import("./testing.ts")).sort()).toMatchInlineSnapshot(`
    [
      "createMemoryTransport",
    ]
  `);
});

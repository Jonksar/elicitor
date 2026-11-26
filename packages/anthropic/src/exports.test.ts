import { expect, test } from "vitest";

// The public surface. A change here is a change to the package's interface: update the README,
// the changeset and this list together.
test("runtime exports of index.ts", async () => {
  expect(Object.keys(await import("./index.ts")).sort()).toMatchInlineSnapshot(`
    [
      "anthropicModel",
    ]
  `);
});

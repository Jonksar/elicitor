import { expect, test } from "vitest";

// The public surface. A change here is a change to the package's interface: update the README,
// the changeset and this list together.
test("runtime exports of index.ts", async () => {
  expect(Object.keys(await import("./index.ts")).sort()).toMatchInlineSnapshot(`
    [
      "DEFAULT_LANGUAGES",
      "DEFAULT_UNAVAILABLE_NOTES",
      "ElicitorError",
      "IntakeUnavailable",
      "MAX_QUESTIONS",
      "buildSystemPrompt",
      "createIntake",
      "createMemoryRoadmap",
      "createMemoryStore",
      "isElicitorError",
      "isIntakeUnavailable",
      "pendingSummaryOf",
      "unavailableModel",
    ]
  `);
});
test("runtime exports of testing.ts", async () => {
  expect(Object.keys(await import("./testing.ts")).sort()).toMatchInlineSnapshot(`
    [
      "createFakeModel",
    ]
  `);
});
test("runtime exports of engine.ts", async () => {
  expect(Object.keys(await import("./engine.ts")).sort()).toMatchInlineSnapshot(`
    [
      "DEFAULT_GLOSSARY_HEADING",
      "DEFAULT_LANGUAGE",
      "DEFAULT_PUBLIC_SUMMARY_RULES",
      "DEFAULT_REPRODUCIBLE_WHEN",
      "MAX_CONTEXT_CHARS",
      "MAX_REGION_TEXT_ENTRIES",
      "QUESTION_LIMIT_NOTE",
      "REPORTER_WROTE",
      "TURN_JSON_SCHEMA",
      "buildModelRequest",
      "countQuestions",
      "isSummary",
      "isTurn",
      "parseTurn",
      "resolveLanguage",
      "runTurn",
    ]
  `);
});

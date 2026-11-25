import { describe, expect, test } from "vitest";
import { isSummary, isTurn, parseTurn, TURN_JSON_SCHEMA } from "./turn.ts";

const summary = {
  title: "Wrong total",
  kind: "figure",
  expected: "1 200.00",
  actual: "1 240.00",
  steps: [],
  publicSummary: "The total on the invoice list does not match the sum of its lines.",
} as const;

describe("parseTurn", () => {
  test("parses structured turns and keeps prose from a provider that dropped the format", () => {
    expect(parseTurn('{"kind":"question","text":"Which month?"}')).toEqual({
      kind: "question",
      text: "Which month?",
    });
    const parsed = parseTurn(JSON.stringify({ kind: "summary", text: "Summary", summary }));
    expect(parsed?.kind).toBe("summary");
    expect(parsed).toEqual({ kind: "summary", text: "Summary", summary });
    expect(parseTurn("Which month?")).toEqual({ kind: "question", text: "Which month?" });
    expect(parseTurn('{"kind":"summary","text":"no summary"}')).toBeNull();
    expect(parseTurn("  ")).toBeNull();
  });

  test("finds the turn inside prose or a code fence from a model that ignored the format", () => {
    const json = '{"kind":"question","text":"Which month?"}';
    expect(parseTurn(`\`\`\`json\n${json}\n\`\`\``)).toEqual({
      kind: "question",
      text: "Which month?",
    });
    expect(parseTurn(`Here it is: ${json} Thanks.`)).toEqual({
      kind: "question",
      text: "Which month?",
    });
    expect(parseTurn('{"kind":"other"}')).toBeNull();
  });

  test("trims prose kept as a question", () => {
    expect(parseTurn("  Which month?\n")).toEqual({ kind: "question", text: "Which month?" });
  });

  test("rejects prose that contains a brace but no valid turn", () => {
    expect(parseTurn("The {total} is wrong")).toBeNull();
    expect(parseTurn("Broken { json")).toBeNull();
  });

  test("drops excess properties", () => {
    expect(
      parseTurn(JSON.stringify({ kind: "question", text: "Which month?", summary, extra: 1 })),
    ).toEqual({ kind: "question", text: "Which month?" });
    const parsed = parseTurn(
      JSON.stringify({ kind: "summary", text: "S", summary: { ...summary, extra: true } }),
    );
    expect(parsed).toEqual({ kind: "summary", text: "S", summary });
  });

  test("rejects a wrong enum, missing fields and non-string steps", () => {
    const bad = (value: unknown) => parseTurn(JSON.stringify(value));
    expect(bad({ kind: "question" })).toBeNull();
    expect(bad({ kind: "question", text: 3 })).toBeNull();
    expect(bad({ kind: "summary", text: "S", summary: { ...summary, kind: "bug" } })).toBeNull();
    expect(bad({ kind: "summary", text: "S", summary: { ...summary, steps: [1] } })).toBeNull();
    expect(bad({ kind: "summary", text: "S", summary: { ...summary, steps: "a" } })).toBeNull();
    const { publicSummary: _omitted, ...withoutPublic } = summary;
    expect(bad({ kind: "summary", text: "S", summary: withoutPublic })).toBeNull();
    // An array is not a turn, but its outermost object is tried next, as for prose.
    expect(isTurn([{ kind: "question", text: "x" }])).toBe(false);
    expect(bad([{ kind: "question", text: "x" }])).toEqual({ kind: "question", text: "x" });
  });
});

describe("guards", () => {
  test("isSummary and isTurn follow the same rules as the parser", () => {
    expect(isSummary(summary)).toBe(true);
    expect(isSummary({ ...summary, extra: 1 })).toBe(true);
    expect(isSummary({ ...summary, kind: "bug" })).toBe(false);
    expect(isSummary(null)).toBe(false);
    expect(isTurn({ kind: "question", text: "x" })).toBe(true);
    expect(isTurn({ kind: "summary", text: "x", summary })).toBe(true);
    expect(isTurn({ kind: "summary", text: "x" })).toBe(false);
    expect(isTurn("x")).toBe(false);
  });

  test("the JSON schema lists the same fields and enums", () => {
    expect(TURN_JSON_SCHEMA.properties.kind.enum).toEqual(["question", "summary"]);
    expect(TURN_JSON_SCHEMA.properties.summary.properties.kind.enum).toEqual([
      "figure",
      "screen",
      "error",
      "other",
    ]);
    expect(TURN_JSON_SCHEMA.properties.summary.required).toEqual(Object.keys(summary));
  });
});

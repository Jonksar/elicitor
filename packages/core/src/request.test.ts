import { describe, expect, test } from "vitest";
import { IntakeUnavailable } from "./errors.ts";
import { createFakeModel, unavailableModel } from "./fake.ts";
import { buildModelRequest, QUESTION_LIMIT_NOTE, resolveLanguage, runTurn } from "./request.ts";
import { TURN_JSON_SCHEMA } from "./turn.ts";
import type { HistoryEntry, TurnInput } from "./types.ts";

const SYSTEM = "system prompt";

const input = (answers: number, overrides: Partial<TurnInput> = {}): TurnInput => ({
  language: "et",
  route: "/reports/summary",
  regionText: ["Total", "1 240.00"],
  context: { bundleId: "index-test.js" },
  screenshotPng: "iVBORw0KGgo=",
  history: [
    { author: "reporter", body: "The total is wrong", kind: null },
    ...Array.from(
      { length: answers },
      (_, index): Array<HistoryEntry> => [
        { author: "agent", kind: "question", body: `Question ${index + 1}` },
        { author: "reporter", kind: null, body: `Answer ${index + 1}` },
      ],
    ).flat(),
  ],
  ...overrides,
});

const firstContent = (turnInput: TurnInput): string =>
  buildModelRequest(turnInput, { system: SYSTEM }).messages[0]!.content;

const rejection = async (promise: Promise<unknown>): Promise<IntakeUnavailable> => {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(IntakeUnavailable);
  return error as IntakeUnavailable;
};

describe("buildModelRequest", () => {
  test("sends the capture first, then the conversation in turn order", () => {
    const request = buildModelRequest(input(1), { system: SYSTEM });
    expect(request).toEqual({
      system: SYSTEM,
      images: [{ png: "iVBORw0KGgo=" }],
      outputSchema: TURN_JSON_SCHEMA,
      messages: [
        {
          role: "user",
          content: [
            "Reporter's language: Estonian.",
            "Screen route: /reports/summary",
            "Text inside the marked region (one entry per element):\nTotal\n1 240.00",
            'Captured context (JSON):\n{"bundleId":"index-test.js"}',
            "The reporter wrote: The total is wrong",
          ].join("\n\n"),
        },
        { role: "assistant", content: "Question 1" },
        { role: "user", content: "Answer 1" },
      ],
    });
  });

  test("omits images without a screenshot and marks an empty region", () => {
    const request = buildModelRequest(input(0, { screenshotPng: null, regionText: [] }), {
      system: SYSTEM,
    });
    expect("images" in request).toBe(false);
    expect("signal" in request).toBe(false);
    expect(request.messages[0]!.content).toContain(
      "Text inside the marked region (one entry per element):\n(nothing marked)",
    );
  });

  test("tells the agent to summarise once it has asked the maximum number of questions", () => {
    expect(buildModelRequest(input(3), { system: SYSTEM }).messages.at(-1)?.content).not.toContain(
      "limit",
    );
    const messages = buildModelRequest(input(4), { system: SYSTEM }).messages;
    // No mid-conversation system message: not every provider accepts one.
    expect(
      messages.every((message) => message.role === "user" || message.role === "assistant"),
    ).toBe(true);
    expect(messages.at(-1)).toEqual({ role: "user", content: QUESTION_LIMIT_NOTE });
    expect(QUESTION_LIMIT_NOTE).toBe(
      '(Note from the application, not the reporter: the question limit is reached. Reply now with kind "summary" and say what is still unknown.)',
    );
    expect(
      buildModelRequest(input(2), { system: SYSTEM, maxQuestions: 2 }).messages.at(-1),
    ).toEqual({ role: "user", content: QUESTION_LIMIT_NOTE });
  });

  test("does not count summary corrections as questions", () => {
    const history: Array<HistoryEntry> = [
      { author: "reporter", body: "Wrong figure", kind: null },
      { author: "agent", body: "Which month?", kind: "question" },
      { author: "reporter", body: "November", kind: null },
      { author: "agent", body: "First summary. Correct?", kind: "summary" },
      { author: "reporter", body: "No", kind: null },
      { author: "agent", body: "What should it be?", kind: "question" },
      { author: "reporter", body: "Zero", kind: null },
      { author: "agent", body: "Second summary. Correct?", kind: "summary" },
      { author: "reporter", body: "Another correction", kind: null },
    ];
    const messages = buildModelRequest(input(0, { history }), { system: SYSTEM }).messages;
    expect(messages.at(-1)).toEqual({ role: "user", content: "Another correction" });
    expect(messages).toHaveLength(history.length);
  });

  test("truncates the context JSON at 20 000 characters", () => {
    const context = { blob: "x".repeat(30_000) };
    const content = firstContent(input(0, { context }));
    const json = content
      .split("Captured context (JSON):\n")[1]!
      .split("\n\nThe reporter wrote:")[0]!;
    expect(json).toHaveLength(20_000);
    expect(json).toBe(JSON.stringify(context).slice(0, 20_000));
    expect(firstContent(input(0, { context: undefined }))).toContain(
      "Captured context (JSON):\nnull",
    );
  });

  test("caps the region text at 200 entries", () => {
    const regionText = Array.from({ length: 250 }, (_, index) => `cell ${index}`);
    const content = firstContent(input(0, { regionText }));
    expect(content).toContain("cell 199\n\nCaptured context");
    expect(content).not.toContain("cell 200");
  });

  test("names the language, normalising region codes and falling back to the default", () => {
    expect(firstContent(input(0, { language: "en-US" }))).toContain(
      "Reporter's language: English.",
    );
    expect(firstContent(input(0, { language: "FI" }))).toContain("Reporter's language: Finnish.");
    expect(firstContent(input(0, { language: "ru_RU" }))).toContain(
      "Reporter's language: Russian.",
    );
    expect(firstContent(input(0, { language: "xx" }))).toContain("Reporter's language: English.");
    const custom = buildModelRequest(input(0, { language: "de-AT" }), {
      system: SYSTEM,
      languages: { de: "German", en: "English" },
    });
    expect(custom.messages[0]!.content).toContain("Reporter's language: German.");
    const fallback = buildModelRequest(input(0, { language: "sv" }), {
      system: SYSTEM,
      defaultLanguage: "et",
    });
    expect(fallback.messages[0]!.content).toContain("Reporter's language: Estonian.");
    expect(resolveLanguage("pt-BR", { pt: 1 }, "en")).toBe("pt");
  });
});

describe("runTurn", () => {
  test("returns the parsed turn and passes the request and signal to the model", async () => {
    const model = createFakeModel([{ kind: "question", text: "Which month?" }]);
    const controller = new AbortController();
    const turn = await runTurn({
      model,
      input: input(0),
      system: SYSTEM,
      signal: controller.signal,
    });
    expect(turn).toEqual({ kind: "question", text: "Which month?" });
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]).toEqual({
      ...buildModelRequest(input(0), { system: SYSTEM }),
      signal: controller.signal,
    });
  });

  test("accepts JSON wrapped in a code fence and keeps prose as a question", async () => {
    const model = createFakeModel([
      '```json\n{"kind":"question","text":"Which month?"}\n```',
      "Which page were you on?",
    ]);
    expect(await runTurn({ model, input: input(0), system: SYSTEM })).toEqual({
      kind: "question",
      text: "Which month?",
    });
    expect(await runTurn({ model, input: input(0), system: SYSTEM })).toEqual({
      kind: "question",
      text: "Which page were you on?",
    });
  });

  test("rejects unparsable output as invalid_output", async () => {
    const model = createFakeModel(['{"kind":"summary","text":"no summary"}']);
    expect((await rejection(runTurn({ model, input: input(0), system: SYSTEM }))).reason).toBe(
      "invalid_output",
    );
  });

  test("rejects another question at the question limit", async () => {
    const model = createFakeModel([
      { kind: "question", text: "One more?" },
      { kind: "question", text: "Fine?" },
    ]);
    expect((await rejection(runTurn({ model, input: input(4), system: SYSTEM }))).reason).toBe(
      "invalid_output",
    );
    expect(
      (await rejection(runTurn({ model, input: input(1), system: SYSTEM, maxQuestions: 1 })))
        .reason,
    ).toBe("invalid_output");
  });

  test("passes IntakeUnavailable through and maps other errors to gateway", async () => {
    const refusal = createFakeModel([new IntakeUnavailable("refusal")]);
    expect(
      (await rejection(runTurn({ model: refusal, input: input(0), system: SYSTEM }))).reason,
    ).toBe("refusal");
    expect(
      (await rejection(runTurn({ model: unavailableModel(), input: input(0), system: SYSTEM })))
        .reason,
    ).toBe("not_configured");
    const cause = new Error("socket hang up");
    const gateway = await rejection(
      runTurn({ model: createFakeModel([cause]), input: input(0), system: SYSTEM }),
    );
    expect(gateway.reason).toBe("gateway");
    expect(gateway.cause).toBe(cause);
  });
});

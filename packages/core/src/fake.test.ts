import { describe, expect, test } from "vitest";
import { IntakeUnavailable } from "./errors.ts";
import { createFakeModel, unavailableModel } from "./fake.ts";
import { buildModelRequest, runTurn } from "./request.ts";
import { parseTurn } from "./turn.ts";
import type { HistoryEntry, ModelRequest, TurnInput } from "./types.ts";

const SYSTEM = "system prompt";

const turnInput = (language: string, history: ReadonlyArray<HistoryEntry>): TurnInput => ({
  language,
  route: "/invoices",
  regionText: ["Total"],
  context: { note: "\n\nThe reporter wrote: not this" },
  screenshotPng: null,
  history,
});

describe("createFakeModel without a script", () => {
  test("asks and summarises in every supported reporter language", async () => {
    const first = "The total on the invoice list is wrong 123";
    const answer = "It should be 456";
    const translations = {
      et: [
        "Mis peaks seal õigesti olema?",
        `Kokkuvõte: ${first} Õige oleks: ${answer}. Kas see on õige?`,
      ],
      en: [
        "What should be shown there instead?",
        `Summary: ${first} It should be: ${answer}. Is this right?`,
      ],
      fi: [
        "Mitä siinä pitäisi näkyä?",
        `Yhteenveto: ${first} Oikein olisi: ${answer}. Onko tämä oikein?`,
      ],
      ru: [
        "Что должно отображаться вместо этого?",
        `Итог: ${first} Должно быть: ${answer}. Всё верно?`,
      ],
    } as const;
    const model = createFakeModel();
    for (const language of ["et", "en", "fi", "ru"] as const) {
      const question = await runTurn({
        model,
        system: SYSTEM,
        input: turnInput(language, [{ author: "reporter", body: first, kind: null }]),
      });
      expect(question).toEqual({ kind: "question", text: translations[language][0] });
      const summary = await runTurn({
        model,
        system: SYSTEM,
        input: turnInput(language, [
          { author: "reporter", body: first, kind: null },
          { author: "agent", body: question.text, kind: "question" },
          { author: "reporter", body: answer, kind: null },
        ]),
      });
      expect(summary).toEqual({
        kind: "summary",
        text: translations[language][1],
        summary: {
          title: first,
          kind: "other",
          expected: answer,
          actual: first,
          steps: [],
          publicSummary: "A user reported a problem on this screen.",
        },
      });
    }
    expect(model.requests).toHaveLength(8);
  });

  test("falls back to English for an unknown language and a region code", async () => {
    const model = createFakeModel();
    const history: Array<HistoryEntry> = [{ author: "reporter", body: "Broken", kind: null }];
    expect(await runTurn({ model, system: SYSTEM, input: turnInput("xx", history) })).toEqual({
      kind: "question",
      text: "What should be shown there instead?",
    });
    expect(await runTurn({ model, system: SYSTEM, input: turnInput("ru-RU", history) })).toEqual({
      kind: "question",
      text: "Что должно отображаться вместо этого?",
    });
  });

  test("counts only its own questions, not summary corrections", async () => {
    const history: Array<HistoryEntry> = [
      { author: "reporter", body: "Wrong figure", kind: null },
      { author: "agent", body: "First summary. Correct?", kind: "summary" },
      { author: "reporter", body: "No", kind: null },
      { author: "agent", body: "Second summary. Correct?", kind: "summary" },
      { author: "reporter", body: "Another correction", kind: null },
    ];
    const turn = await runTurn({
      model: createFakeModel(),
      system: SYSTEM,
      input: turnInput("en", history),
    });
    expect(turn.kind).toBe("question");
  });

  test("summarises the latest answer, skipping the question-limit note", async () => {
    const history: Array<HistoryEntry> = [
      { author: "reporter", body: "Wrong figure", kind: null },
      { author: "agent", body: "What should be shown there instead?", kind: "question" },
      { author: "reporter", body: "Zero", kind: null },
    ];
    const turn = await runTurn({
      model: createFakeModel(),
      system: SYSTEM,
      maxQuestions: 1,
      input: turnInput("en", history),
    });
    expect(turn.kind === "summary" && turn.summary.expected).toBe("Zero");
    expect(turn.kind === "summary" && turn.summary.actual).toBe("Wrong figure");
  });

  test("reads the request format buildModelRequest writes", async () => {
    const request = buildModelRequest(
      turnInput("fi", [{ author: "reporter", body: "Sentence", kind: null }]),
      { system: SYSTEM },
    );
    const raw = await createFakeModel().complete(request);
    expect(JSON.parse(raw)).toEqual({ kind: "question", text: "Mitä siinä pitäisi näkyä?" });
  });
});

describe("createFakeModel with a script", () => {
  test("consumes turns, raw text, functions and errors in order and records requests", async () => {
    const seen: Array<ModelRequest> = [];
    const failure = new Error("boom");
    const model = createFakeModel([
      { kind: "question", text: "Which month?" },
      "raw text",
      async (request) => {
        seen.push(request);
        return { kind: "question", text: "From a function" };
      },
      failure,
    ]);
    const request = buildModelRequest(
      turnInput("en", [{ author: "reporter", body: "Sentence", kind: null }]),
      { system: SYSTEM },
    );
    expect(await model.complete(request)).toBe('{"kind":"question","text":"Which month?"}');
    expect(await model.complete(request)).toBe("raw text");
    expect(await model.complete(request)).toBe('{"kind":"question","text":"From a function"}');
    await expect(model.complete(request)).rejects.toBe(failure);
    await expect(model.complete(request)).rejects.toThrow("exhausted");
    expect(seen).toEqual([request]);
    expect(model.requests).toHaveLength(5);
  });
});

describe("createFakeModel with options", () => {
  const first = () =>
    buildModelRequest(turnInput("en", [{ author: "reporter", body: "Sentence", kind: null }]), {
      system: SYSTEM,
    });
  const answered = () =>
    buildModelRequest(
      turnInput("en", [
        { author: "reporter", body: "Sentence", kind: null },
        { author: "agent", body: "What should be shown there instead?", kind: "question" },
        { author: "reporter", body: "Two", kind: null },
      ]),
      { system: SYSTEM },
    );

  test("takes the script as an option", async () => {
    const model = createFakeModel({ script: ["raw text"] });
    expect(await model.complete(first())).toBe("raw text");
    await expect(model.complete(first())).rejects.toThrow("exhausted");
    expect(model.requests).toHaveLength(2);
  });

  test("uses the given public summary in the built-in agent's summaries", async () => {
    const model = createFakeModel({ publicSummary: "Someone reported a problem." });
    const turn = parseTurn(await model.complete(answered()));
    expect(turn).toMatchObject({
      kind: "summary",
      summary: { publicSummary: "Someone reported a problem." },
    });
  });

  test("keeps nothing per call with record: false", async () => {
    const model = createFakeModel({ record: false });
    for (let index = 0; index < 3; index++) await model.complete(first());
    expect(model.requests).toHaveLength(0);
    const scripted = createFakeModel({ script: ["a"], record: false });
    await scripted.complete(first());
    expect(scripted.requests).toHaveLength(0);
  });
});

test("unavailableModel always throws IntakeUnavailable", async () => {
  const request = buildModelRequest(
    turnInput("en", [{ author: "reporter", body: "Sentence", kind: null }]),
    { system: SYSTEM },
  );
  await expect(unavailableModel().complete(request)).rejects.toMatchObject({
    name: "IntakeUnavailable",
    reason: "not_configured",
  });
  await expect(unavailableModel("refusal").complete(request)).rejects.toBeInstanceOf(
    IntakeUnavailable,
  );
});

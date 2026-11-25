import { describe, expect, test, vi } from "vitest";
import { ElicitorError, IntakeUnavailable } from "./errors.ts";
import { createFakeModel, type FakeStep, unavailableModel } from "./fake.ts";
import { createIntake, DEFAULT_UNAVAILABLE_NOTES, type IntakeOptions } from "./intake.ts";
import { createMemoryStore, type MemoryStore } from "./memory-store.ts";
import { buildSystemPrompt } from "./prompt.ts";
import type { ElicitorErrorCode, ModelAdapter, ModelRequest, NewReport, Turn } from "./types.ts";

const PROMPT = { productDescription: "Acme Books, an online bookkeeping application" };

const report = (overrides: Partial<NewReport> = {}): NewReport => ({
  sentence: "The total on the invoice list is wrong",
  language: "et",
  route: "/invoices?month=3",
  region: { x: 10, y: 20, width: 100, height: 200, viewportWidth: 1280, viewportHeight: 800 },
  regionText: ["Total 1234"],
  context: { bundleId: "index-test.js" },
  screenshotPng: "iVBORw0KGgo=",
  ...overrides,
});

const setup = (model: ModelAdapter = createFakeModel(), extra: Partial<IntakeOptions> = {}) => {
  let tick = 0;
  const store = createMemoryStore({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick++)).toISOString(),
  });
  const onUnavailable = vi.fn();
  const intake = createIntake({ model, store, prompt: PROMPT, onUnavailable, ...extra });
  return { store, intake, onUnavailable };
};

const refused = async (promise: Promise<unknown>, code: ElicitorErrorCode): Promise<void> => {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ElicitorError);
  expect((error as ElicitorError).code).toBe(code);
};

const detail = (store: MemoryStore, id: string) => store.toDetail(id, { canAct: true })!;

interface Deferred {
  readonly began: Promise<void>;
  release(): void;
}
/** A script step that waits for release() and then answers with `then`. */
const deferredStep = (then: FakeStep): { step: FakeStep; control: Deferred } => {
  let began!: () => void;
  let release!: () => void;
  const beganPromise = new Promise<void>((resolve) => {
    began = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    control: { began: beganPromise, release },
    step: async (request: ModelRequest) => {
      began();
      await released;
      if (then instanceof Error) throw then;
      if (typeof then === "function") return then(request);
      return then;
    },
  };
};

/** A model that answers like the scripted fake, except for requests matched by `hold`. */
const holdingModel = (hold: (request: ModelRequest) => FakeStep | null): ModelAdapter => {
  const scripted = createFakeModel();
  return {
    async complete(request) {
      const step = hold(request);
      if (step === null) return scripted.complete(request);
      return createFakeModel([step]).complete(request);
    },
  };
};

describe("createIntake", () => {
  test("asks, summarises on the answer and submits on confirmation", async () => {
    const { store, intake, onUnavailable } = setup();
    const { id } = await intake.start(report());
    let current = detail(store, id);
    expect(current.status).toBe("intake");
    expect(current.title).toBe("The total on the invoice list is wrong");
    expect(current.messages.map((message) => message.author)).toEqual(["reporter", "agent"]);
    expect(current.messages[1]?.body).toBe("Mis peaks seal õigesti olema?");
    expect(current.pendingSummary).toBeNull();
    await refused(intake.confirm(id, 0), "stale");
    await refused(intake.confirm(id, 2), "stale");

    await intake.reply(id, "  4 200.00  ");
    current = detail(store, id);
    expect(current.status).toBe("intake");
    expect(current.messages[2]?.body).toBe("4 200.00");
    expect(current.pendingSummary?.expected).toBe("4 200.00");
    expect(current.pendingSummarySeq).toBe(4);
    expect(current.messages[3]?.body).toBe(
      "Kokkuvõte: The total on the invoice list is wrong Õige oleks: 4 200.00. Kas see on õige?",
    );
    const firstSummarySeq = current.pendingSummarySeq!;

    await intake.reply(id, "4 300.00");
    current = detail(store, id);
    expect(current.pendingSummary?.expected).toBe("4 300.00");
    await refused(intake.confirm(id, firstSummarySeq), "stale");

    await intake.confirm(id, current.pendingSummarySeq!);
    current = detail(store, id);
    expect(current.status).toBe("submitted");
    expect(current.pendingSummary).toBeNull();
    expect(current.pendingSummarySeq).toBeNull();
    expect(current.summary?.expected).toBe("4 300.00");
    expect(current.title).toBe("The total on the invoice list is wrong".slice(0, 80));
    expect(current.canReply).toBe(false);
    expect(current.canConfirm).toBe(false);

    await refused(intake.reply(id, "Too late"), "invalid");
    await refused(intake.confirm(id, 0), "stale");
    await refused(intake.confirm(id, current.messages.at(-1)!.seq), "stale");
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  test("a correction after a summary does not count as a question", async () => {
    const model = createFakeModel();
    const { store, intake } = setup(model, { maxQuestions: 1 });
    const { id } = await intake.start(report({ language: "en" }));
    await intake.reply(id, "Zero");
    await intake.reply(id, "No, it should be one");
    await intake.reply(id, "Still wrong");
    const current = detail(store, id);
    expect(current.status).toBe("intake");
    expect(current.pendingSummary?.expected).toBe("Still wrong");
    expect(model.requests.at(-1)?.messages.at(-1)?.content).toContain("question limit");
  });

  test("confirming while the latest message is a reporter correction is stale", async () => {
    const summaryTurn: Turn = {
      kind: "summary",
      text: "Is this right?",
      summary: {
        title: "Wrong total",
        kind: "figure",
        expected: "1",
        actual: "2",
        steps: [],
        publicSummary: "The total on the invoice list is wrong.",
      },
    };
    const held = deferredStep(summaryTurn);
    const model = createFakeModel([summaryTurn, held.step]);
    const { store, intake } = setup(model);
    const { id } = await intake.start(report());
    expect(detail(store, id).pendingSummarySeq).toBe(2);
    const replying = intake.reply(id, "Not quite");
    await held.control.began;
    await refused(intake.confirm(id, 2), "stale");
    expect(detail(store, id).pendingSummary).toBeNull();
    held.control.release();
    await replying;
    await intake.confirm(id, 4);
    expect(detail(store, id).status).toBe("submitted");
    expect(detail(store, id).summary).toEqual(summaryTurn.summary);
  });

  test("submits as written when the agent is unavailable", async () => {
    const { store, intake, onUnavailable } = setup(createFakeModel([new Error("socket closed")]));
    const { id } = await intake.start(report());
    const current = detail(store, id);
    expect(current.status).toBe("submitted");
    expect(current.title).toBe("The total on the invoice list is wrong");
    expect(current.messages.map((message) => message.author)).toEqual(["reporter", "system"]);
    expect(current.messages[0]?.body).toBe(report().sentence);
    expect(current.messages[1]?.body).toBe(DEFAULT_UNAVAILABLE_NOTES.et);
    expect(current.pendingSummary).toBeNull();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith({
      reportId: id,
      reason: "gateway",
      cause: expect.objectContaining({ message: "socket closed" }),
    });
    await refused(intake.reply(id, "More detail"), "invalid");
  });

  test.each([
    ["et", DEFAULT_UNAVAILABLE_NOTES.et],
    ["en", "The assistant is not available right now. The report was sent on as you wrote it."],
    ["fi", "Avustaja ei ole juuri nyt käytettävissä. Ilmoitus lähetettiin kuvauksesi perusteella."],
    ["ru", "Помощник сейчас недоступен. Сообщение отправлено по вашему описанию."],
    ["fi-FI", DEFAULT_UNAVAILABLE_NOTES.fi],
    ["xx", DEFAULT_UNAVAILABLE_NOTES.en],
  ])("writes the unavailable note in %s", async (language, note) => {
    const { store, intake } = setup(unavailableModel());
    const { id } = await intake.start(report({ language }));
    expect(detail(store, id).messages[1]?.body).toBe(note);
  });

  test("unavailable notes can be overridden and the default language changed", async () => {
    const { store, intake } = setup(unavailableModel(), {
      unavailableNotes: { de: "Nicht verfügbar.", en: "Sent as written." },
      defaultLanguage: "de",
    });
    const german = await intake.start(report({ language: "de-DE" }));
    expect(detail(store, german.id).messages[1]?.body).toBe("Nicht verfügbar.");
    const unknown = await intake.start(report({ language: "xx" }));
    expect(detail(store, unknown.id).messages[1]?.body).toBe("Nicht verfügbar.");
    const english = await intake.start(report({ language: "en" }));
    expect(detail(store, english.id).messages[1]?.body).toBe("Sent as written.");
  });

  test.each([
    ["refusal", new IntakeUnavailable("refusal")],
    ["gateway", new Error("timeout")],
    ["invalid_output", '{"kind":"question"}'],
    ["not_configured", new IntakeUnavailable("not_configured")],
  ] as const)("reports %s to onUnavailable and submits as written", async (reason, step) => {
    const { store, intake, onUnavailable } = setup(createFakeModel([step]));
    const { id } = await intake.start(report({ language: "en" }));
    expect(detail(store, id).status).toBe("submitted");
    expect(detail(store, id).messages.at(-1)).toMatchObject({
      author: "system",
      body: DEFAULT_UNAVAILABLE_NOTES.en,
    });
    expect(onUnavailable).toHaveBeenCalledWith(expect.objectContaining({ reportId: id, reason }));
  });

  test("an unconfigured model submits without a conversation", async () => {
    const model = unavailableModel();
    const complete = vi.spyOn(model, "complete");
    const { store, intake, onUnavailable } = setup(model);
    const { id } = await intake.start(report());
    expect(complete).toHaveBeenCalledTimes(1);
    expect(detail(store, id).status).toBe("submitted");
    expect(onUnavailable).toHaveBeenCalledWith({ reportId: id, reason: "not_configured" });
  });

  test("an invalid JSON object submits as written with the system note", async () => {
    const { store, intake } = setup(createFakeModel(['{"kind":"summary","text":"no summary"}']));
    const { id } = await intake.start(report({ language: "en" }));
    expect(detail(store, id).status).toBe("submitted");
    expect(detail(store, id).messages[1]).toMatchObject({
      author: "system",
      body: DEFAULT_UNAVAILABLE_NOTES.en,
    });
  });

  test("a model that keeps asking past the limit sends the report on as written", async () => {
    const asks = Array.from(
      { length: 5 },
      (_, index): Turn => ({
        kind: "question",
        text: `Question ${index + 1}?`,
      }),
    );
    const model = createFakeModel(asks);
    const { store, intake, onUnavailable } = setup(model);
    const { id } = await intake.start(report());
    for (const answer of ["a", "b", "c"]) await intake.reply(id, answer);
    expect(detail(store, id).status).toBe("intake");
    expect(model.requests.at(-1)?.messages.at(-1)?.content).toBe("c");
    await intake.reply(id, "d");
    expect(model.requests.at(-1)?.messages.at(-1)?.content).toContain("question limit");
    const current = detail(store, id);
    expect(current.status).toBe("submitted");
    expect(current.messages.filter((message) => message.author === "agent")).toHaveLength(4);
    expect(current.messages.at(-1)?.author).toBe("system");
    expect(onUnavailable).toHaveBeenCalledWith({ reportId: id, reason: "invalid_output" });
  });

  test("prose output is kept as a question; fenced and wrapped JSON is parsed", async () => {
    const model = createFakeModel([
      "Which page were you on?",
      '```json\n{"kind":"question","text":"Which month?"}\n```',
      'Sure: {"kind":"question","text":"Which year?"} done',
    ]);
    const { store, intake } = setup(model);
    const { id } = await intake.start(report());
    await intake.reply(id, "The list");
    await intake.reply(id, "March");
    expect(
      detail(store, id)
        .messages.filter((message) => message.author === "agent")
        .map((message) => message.body),
    ).toEqual(["Which page were you on?", "Which month?", "Which year?"]);
    const stored = await store.get(id);
    expect(stored?.messages[1]?.turn).toEqual({
      kind: "question",
      text: "Which page were you on?",
    });
  });

  test("builds the prompt once with the engine's question limit", async () => {
    const model = createFakeModel([{ kind: "question", text: "Q?" }]);
    const { intake } = setup(model, { maxQuestions: 2 });
    await intake.start(report());
    expect(model.requests[0]?.system).toBe(buildSystemPrompt({ ...PROMPT, maxQuestions: 2 }));
    expect(model.requests[0]?.system).toContain("Ask at most 2 questions");
    const fromPrompt = createFakeModel([{ kind: "question", text: "Q?" }]);
    const custom = setup(fromPrompt, { prompt: "Custom system prompt" });
    await custom.intake.start(report());
    expect(fromPrompt.requests[0]?.system).toBe("Custom system prompt");
  });

  test("sends the capture, history and screenshot to the model", async () => {
    const model = createFakeModel();
    const { intake } = setup(model);
    const { id } = await intake.start(report());
    await intake.reply(id, "4 200.00");
    const request = model.requests[1]!;
    expect(request.images).toEqual([{ png: "iVBORw0KGgo=" }]);
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(request.messages[0]?.content).toContain("Screen route: /invoices?month=3");
    expect(request.messages[0]?.content).toContain("Total 1234");
    expect(request.messages[0]?.content).toContain(
      "The reporter wrote: The total on the invoice list is wrong",
    );
  });

  test("rejects a blank sentence or reply", async () => {
    const { store, intake } = setup();
    await refused(intake.start(report({ sentence: "   " })), "invalid");
    expect(store.list()).toEqual([]);
    const { id } = await intake.start(report());
    await refused(intake.reply(id, " \n "), "invalid");
    expect(detail(store, id).messages).toHaveLength(2);
  });

  test("unknown ids are not_found", async () => {
    const { intake } = setup();
    await refused(intake.reply("missing", "Hello"), "not_found");
    await refused(intake.confirm("missing", 2), "not_found");
    await refused(intake.withdraw("missing"), "not_found");
    await refused(
      intake.advance("missing", 1, {
        language: "en",
        route: "/",
        regionText: [],
        context: {},
        screenshotPng: null,
      }),
      "not_found",
    );
  });

  test("withdraw is allowed only from intake and submitted", async () => {
    const { store, intake } = setup(unavailableModel());
    const submitted = await intake.start(report());
    expect(detail(store, submitted.id).canWithdraw).toBe(true);
    await intake.withdraw(submitted.id);
    expect(store.list()[0]?.status).toBe("withdrawn");
    await refused(intake.withdraw(submitted.id), "invalid");

    const talking = setup();
    const inIntake = await talking.intake.start(report());
    await talking.intake.withdraw(inIntake.id);
    expect(detail(talking.store, inIntake.id).status).toBe("withdrawn");
    await refused(talking.intake.reply(inIntake.id, "Hello"), "invalid");
    await refused(talking.intake.confirm(inIntake.id, 2), "stale");

    for (const status of ["in_progress", "needs_reply", "fixed", "closed"] as const) {
      const other = await talking.intake.start(report());
      talking.store.setStatus(other.id, status);
      await refused(talking.intake.withdraw(other.id), "invalid");
      await refused(talking.intake.reply(other.id, "Hello"), "invalid");
    }
  });

  test("drops a late turn after the report was withdrawn", async () => {
    for (const late of [{ kind: "question", text: "Late?" } as Turn, new Error("late failure")]) {
      const held = deferredStep(late);
      const { store, intake, onUnavailable } = setup(createFakeModel([held.step]));
      const starting = intake.start(report());
      await held.control.began;
      const [listed] = store.list();
      await intake.withdraw(listed!.id);
      held.control.release();
      const { id } = await starting;
      const current = detail(store, id);
      expect(current.status).toBe("withdrawn");
      expect(current.messages.map((message) => message.author)).toEqual(["reporter"]);
      expect(onUnavailable).toHaveBeenCalledTimes(late instanceof Error ? 1 : 0);
    }
  });

  test("drops a slow first turn when the reporter wrote again meanwhile", async () => {
    const held = deferredStep(async (request) => createFakeModel().complete(request));
    let first = true;
    const model = holdingModel(() => {
      if (!first) return null;
      first = false;
      return held.step;
    });
    const { store, intake } = setup(model);
    const starting = intake.start(report({ sentence: "Slow first turn" }));
    await held.control.began;
    const waiting = store.list().find((item) => item.sentence === "Slow first turn")!;
    await intake.reply(waiting.id, "Answer before the first turn");
    const answered = detail(store, waiting.id).messages;
    held.control.release();
    await starting;
    expect(detail(store, waiting.id).messages).toEqual(answered);
    expect(answered.map((message) => message.author)).toEqual(["reporter", "reporter", "agent"]);
  });

  test.each([false, true])(
    "drops a late answer to an older reply (late failure: %s)",
    async (lateFailure) => {
      let held: ReturnType<typeof deferredStep> | null = null;
      const model = holdingModel((request) => {
        if (request.messages.at(-1)?.content !== "Older answer") return null;
        held = deferredStep(
          lateFailure
            ? new IntakeUnavailable("gateway")
            : async (inner: ModelRequest) => createFakeModel().complete(inner),
        );
        return held.step;
      });
      const { store, intake, onUnavailable } = setup(model);
      const { id } = await intake.start(report());
      const older = intake.reply(id, "Older answer");
      await vi.waitFor(() => expect(held).not.toBeNull());
      const control = (held as ReturnType<typeof deferredStep> | null)!.control;
      await control.began;
      await intake.reply(id, "Newest answer");
      const newer = detail(store, id);
      expect(newer.pendingSummary?.expected).toBe("Newest answer");
      control.release();
      await older;
      const afterOlder = detail(store, id);
      expect(afterOlder.status).toBe("intake");
      expect(afterOlder.pendingSummary?.expected).toBe("Newest answer");
      expect(afterOlder.messages).toEqual(newer.messages);
      expect(afterOlder.pendingSummarySeq).toBe(newer.pendingSummarySeq);
      expect(onUnavailable).toHaveBeenCalledTimes(lateFailure ? 1 : 0);
    },
  );

  test("a storage failure after the reply is saved propagates and runs no fallback", async () => {
    const model = createFakeModel();
    const { store, intake, onUnavailable } = setup(model);
    const { id } = await intake.start(report());
    const failure = new Error("storage unavailable");
    vi.spyOn(store, "loadCapture").mockRejectedValueOnce(failure);
    await expect(intake.reply(id, "4 200.00")).rejects.toBe(failure);
    const current = detail(store, id);
    expect(current.status).toBe("intake");
    expect(current.messages.at(-1)).toMatchObject({ author: "reporter", body: "4 200.00" });
    expect(model.requests).toHaveLength(1);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  test("advance answers rows the host created itself", async () => {
    const store = createMemoryStore();
    const intake = createIntake({ model: createFakeModel(), store, prompt: PROMPT });
    const input = report({ language: "en" });
    const { id, seq } = await store.create(input);
    await intake.advance(id, seq, {
      language: input.language,
      route: input.route,
      regionText: input.regionText,
      context: input.context,
      screenshotPng: input.screenshotPng,
    });
    expect(store.toDetail(id, { canAct: true })?.messages[1]?.body).toBe(
      "What should be shown there instead?",
    );
  });

  test("start needs a store with create; advance does not", async () => {
    const { create: _create, ...rest } = createMemoryStore();
    const intake = createIntake({ model: createFakeModel(), store: rest, prompt: PROMPT });
    await expect(intake.start(report())).rejects.toBeInstanceOf(TypeError);
    await expect(intake.start(report())).rejects.toThrow("advance");
  });

  test("passes the signal to the model", async () => {
    const model = createFakeModel();
    const { intake } = setup(model);
    const controller = new AbortController();
    const { id } = await intake.start(report(), { signal: controller.signal });
    await intake.reply(id, "4 200.00", { signal: controller.signal });
    expect(model.requests.map((request) => request.signal)).toEqual([
      controller.signal,
      controller.signal,
    ]);
  });

  test("an aborted reply rethrows the abort, keeps the reply and runs no fallback", async () => {
    const controller = new AbortController();
    // The adapter turns the aborted request into IntakeUnavailable("gateway"), as real ones do.
    const { step, control } = deferredStep(new IntakeUnavailable("gateway"));
    const { store, intake, onUnavailable } = setup(
      holdingModel((request) => (request.messages.length > 1 ? step : null)),
    );
    const { id } = await intake.start(report());
    const replying = intake.reply(id, "4 200.00", { signal: controller.signal });
    await control.began;
    const reason = new Error("request interrupted");
    controller.abort(reason);
    control.release();
    await expect(replying).rejects.toBe(reason);
    const current = detail(store, id);
    expect(current.status).toBe("intake");
    expect(current.messages.at(-1)).toMatchObject({ author: "reporter", body: "4 200.00" });
    expect(current.messages.some((message) => message.author === "system")).toBe(false);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  test("an abort after the model answered commits nothing", async () => {
    const controller = new AbortController();
    const { step, control } = deferredStep({ kind: "question", text: "Which month?" });
    const { store, intake } = setup(createFakeModel([step]));
    const { id, seq } = await store.create(report());
    const advancing = intake.advance(id, seq, report(), { signal: controller.signal });
    await control.began;
    controller.abort();
    control.release();
    await expect(advancing).rejects.toMatchObject({ name: "AbortError" });
    expect(detail(store, id).messages).toHaveLength(1);
    expect(detail(store, id).status).toBe("intake");
  });

  test("an already aborted signal calls no model", async () => {
    const model = createFakeModel();
    const { store, intake } = setup(model);
    const { id } = await intake.start(report(), { signal: AbortSignal.abort() }).then(
      () => ({ id: "" }),
      () => ({ id: store.list()[0]!.id }),
    );
    expect(model.requests).toHaveLength(0);
    expect(detail(store, id)).toMatchObject({ status: "intake", messages: [{ seq: 1 }] });
  });

  test("a throwing onUnavailable hook does not keep the report in intake", async () => {
    const { store, intake } = setup(unavailableModel(), {
      onUnavailable: () => {
        throw new Error("logger down");
      },
    });
    const { id } = await intake.start(report());
    expect(detail(store, id).status).toBe("submitted");
  });
});

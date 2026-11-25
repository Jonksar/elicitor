import { ElicitorError, isIntakeUnavailable } from "./errors.ts";
import { buildSystemPrompt, type SystemPromptOptions } from "./prompt.ts";
import { DEFAULT_LANGUAGE, resolveLanguage, runTurn } from "./request.ts";
import { MAX_QUESTIONS } from "./turn.ts";
import type {
  Capture,
  HistoryEntry,
  IntakeUnavailableReason,
  ModelAdapter,
  NewReport,
  ReportStore,
  TurnOutcome,
} from "./types.ts";

/** The system note appended when the assistant is unavailable, by language code. */
export const DEFAULT_UNAVAILABLE_NOTES: Readonly<Record<string, string>> = {
  et: "Abiline ei ole praegu saadaval. Teade saadeti edasi sinu kirjelduse põhjal.",
  en: "The assistant is not available right now. The report was sent on as you wrote it.",
  fi: "Avustaja ei ole juuri nyt käytettävissä. Ilmoitus lähetettiin kuvauksesi perusteella.",
  ru: "Помощник сейчас недоступен. Сообщение отправлено по вашему описанию.",
};

export interface UnavailableInfo {
  readonly reportId: string;
  readonly reason: IntakeUnavailableReason;
  readonly cause?: unknown;
}

export interface IntakeOptions {
  readonly model: ModelAdapter;
  readonly store: ReportStore;
  /** The system prompt, or the options to build it with (maxQuestions is then taken from here). */
  readonly prompt: string | SystemPromptOptions;
  readonly maxQuestions?: number;
  /** Language code to English name for the model. */
  readonly languages?: Readonly<Record<string, string>>;
  readonly defaultLanguage?: string;
  /** Overrides or adds unavailable notes per language code. */
  readonly unavailableNotes?: Readonly<Record<string, string>>;
  /** Called when a turn falls back to submitting as written. Errors it throws are ignored. */
  readonly onUnavailable?: (info: UnavailableInfo) => void;
}

/**
 * Per-call options of the methods that run an agent turn. Aborting `signal` aborts the model call
 * and rejects with the signal's reason: nothing is committed, so the report stays in intake (a
 * reply already saved stays saved) and the submit-as-written fallback does not run.
 */
export interface TurnCallOptions {
  readonly signal?: AbortSignal;
}

export interface Intake {
  /** Creates the report through `store.create` and runs the first agent turn. */
  start(input: NewReport, options?: TurnCallOptions): Promise<{ readonly id: string }>;
  /** Saves the reporter's answer or correction and runs the next agent turn. */
  reply(id: string, body: string, options?: TurnCallOptions): Promise<void>;
  /**
   * Runs the agent turn that answers message `expectedSeq`, for hosts that create rows
   * themselves (their store needs no `create`). The answer is dropped if the report moved on
   * meanwhile.
   */
  advance(
    id: string,
    expectedSeq: number,
    capture: Capture,
    options?: TurnCallOptions,
  ): Promise<void>;
  /** Accepts the pending summary whose message seq is `expectedSeq`. */
  confirm(id: string, expectedSeq: number): Promise<void>;
  withdraw(id: string): Promise<void>;
}

/**
 * The intake conversation over a store and a model. Authorisation is the host's concern: core
 * acts on any id it is given.
 */
export const createIntake = (options: IntakeOptions): Intake => {
  const { model, store } = options;
  const maxQuestions =
    options.maxQuestions ??
    (typeof options.prompt === "string" ? undefined : options.prompt.maxQuestions) ??
    MAX_QUESTIONS;
  const defaultLanguage = options.defaultLanguage ?? DEFAULT_LANGUAGE;
  const system =
    typeof options.prompt === "string"
      ? options.prompt
      : buildSystemPrompt({ ...options.prompt, maxQuestions });
  const notes = { ...DEFAULT_UNAVAILABLE_NOTES, ...options.unavailableNotes };
  const noteFor = (language: string): string =>
    notes[resolveLanguage(language, notes, defaultLanguage)] ?? DEFAULT_UNAVAILABLE_NOTES.en!;

  const advance = async (
    id: string,
    expectedSeq: number,
    capture: Capture,
    callOptions: TurnCallOptions = {},
  ): Promise<void> => {
    const { signal } = callOptions;
    signal?.throwIfAborted();
    const report = await store.get(id);
    if (!report) throw new ElicitorError("not_found");
    const history = report.messages.flatMap(
      (message): Array<HistoryEntry> =>
        message.seq <= expectedSeq && (message.author === "reporter" || message.author === "agent")
          ? [
              {
                author: message.author,
                body: message.body,
                kind: message.author === "agent" ? (message.turn?.kind ?? null) : null,
              },
            ]
          : [],
    );
    let outcome: TurnOutcome;
    try {
      const turn = await runTurn({
        model,
        input: { ...capture, history },
        system,
        maxQuestions,
        defaultLanguage,
        ...(options.languages ? { languages: options.languages } : {}),
        ...(signal ? { signal } : {}),
      });
      outcome = { kind: "turn", turn };
    } catch (error) {
      // The caller gave up: not the assistant's failure, so no fallback and nothing committed.
      if (signal?.aborted) throw signal.reason;
      if (!isIntakeUnavailable(error)) throw error;
      try {
        options.onUnavailable?.({
          reportId: id,
          reason: error.reason,
          ...(error.cause !== undefined ? { cause: error.cause } : {}),
        });
      } catch {
        // A failing hook must not keep the report in intake.
      }
      outcome = { kind: "unavailable", note: noteFor(capture.language), reason: error.reason };
    }
    signal?.throwIfAborted();
    // false: the report was withdrawn or the reporter wrote again meanwhile; drop the late turn.
    await store.commitTurn(id, expectedSeq, outcome);
  };

  return {
    async start(input, callOptions) {
      if (!store.create)
        throw new TypeError(
          "intake.start() needs a store with create(); hosts that create rows themselves call intake.advance()",
        );
      if (!input.sentence.trim()) throw new ElicitorError("invalid", "The sentence is empty");
      const { id, seq } = await store.create(input);
      await advance(
        id,
        seq,
        {
          language: input.language,
          route: input.route,
          regionText: input.regionText,
          context: input.context,
          screenshotPng: input.screenshotPng,
        },
        callOptions,
      );
      return { id };
    },

    async reply(id, body, callOptions) {
      const text = body.trim();
      if (!text) throw new ElicitorError("invalid", "The reply is empty");
      const appended = await store.appendReporterMessage(id, text);
      if (!appended.ok)
        throw appended.reason === "not_found"
          ? new ElicitorError("not_found")
          : new ElicitorError("invalid", "The report is no longer in intake");
      // Errors from here on leave the reply saved; they pass through unchanged.
      const capture = await store.loadCapture(id);
      if (!capture) throw new ElicitorError("not_found");
      await advance(id, appended.seq, capture, callOptions);
    },

    advance,

    async confirm(id, expectedSeq) {
      const result = await store.confirm(id, expectedSeq);
      if (result === "not_found") throw new ElicitorError("not_found");
      if (result === "stale")
        throw new ElicitorError("stale", "There is no pending summary with this seq");
    },

    async withdraw(id) {
      const result = await store.withdraw(id);
      if (result === "not_found") throw new ElicitorError("not_found");
      if (result === "not_allowed")
        throw new ElicitorError("invalid", "Only reports in intake or submitted can be withdrawn");
    },
  };
};

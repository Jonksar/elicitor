import { IntakeUnavailable, isIntakeUnavailable } from "./errors.ts";
import { MAX_QUESTIONS, parseTurn, TURN_JSON_SCHEMA } from "./turn.ts";
import type {
  HistoryEntry,
  ModelAdapter,
  ModelMessage,
  ModelRequest,
  Turn,
  TurnInput,
} from "./types.ts";

/** Language code to English name, as the model is told. */
export const DEFAULT_LANGUAGES: Readonly<Record<string, string>> = {
  en: "English",
  et: "Estonian",
  fi: "Finnish",
  ru: "Russian",
};

export const DEFAULT_LANGUAGE = "en";

/** Most text inside the marked region the model sees, in entries. */
export const MAX_REGION_TEXT_ENTRIES = 200;
/** Most characters of the captured context JSON the model sees. */
export const MAX_CONTEXT_CHARS = 20_000;

/** The user message sent once the agent has asked its last question. */
export const QUESTION_LIMIT_NOTE =
  '(Note from the application, not the reporter: the question limit is reached. Reply now with kind "summary" and say what is still unknown.)';

/** Prefix of the reporter's opening sentence inside the first user message. */
export const REPORTER_WROTE = "The reporter wrote: ";

/**
 * Picks the key of `table` for a language code: "en-US" and "EN" find "en". Unknown codes give
 * `defaultLanguage`.
 */
export const resolveLanguage = (
  code: string,
  table: Readonly<Record<string, unknown>>,
  defaultLanguage: string = DEFAULT_LANGUAGE,
): string => {
  const base = code.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return Object.hasOwn(table, base) ? base : defaultLanguage;
};

/** Agent questions asked so far. Summary turns (and corrections to them) do not count. */
export const countQuestions = (history: ReadonlyArray<HistoryEntry>): number =>
  history.filter((entry) => entry.author === "agent" && entry.kind === "question").length;

export interface ModelRequestOptions {
  readonly system: string;
  readonly maxQuestions?: number;
  readonly languages?: Readonly<Record<string, string>>;
  readonly defaultLanguage?: string;
}

/**
 * The request for one turn. The first user message carries the capture followed by the reporter's
 * sentence; later history alternates as plain text. At the question limit a note from the
 * application asks for the summary.
 */
export const buildModelRequest = (input: TurnInput, options: ModelRequestOptions): ModelRequest => {
  const languages = options.languages ?? DEFAULT_LANGUAGES;
  const code = resolveLanguage(input.language, languages, options.defaultLanguage);
  const languageName = languages[code] ?? code;
  const context = JSON.stringify(input.context) ?? "null";
  const capture = [
    `Reporter's language: ${languageName}.`,
    `Screen route: ${input.route}`,
    `Text inside the marked region (one entry per element):\n${input.regionText.slice(0, MAX_REGION_TEXT_ENTRIES).join("\n") || "(nothing marked)"}`,
    `Captured context (JSON):\n${context.slice(0, MAX_CONTEXT_CHARS)}`,
    `${REPORTER_WROTE}${input.history[0]?.body ?? ""}`,
  ].join("\n\n");
  const messages: Array<ModelMessage> = [{ role: "user", content: capture }];
  for (const entry of input.history.slice(1))
    messages.push({ role: entry.author === "agent" ? "assistant" : "user", content: entry.body });
  // A plain user turn rather than a mid-conversation system message: not every provider accepts
  // system messages inside the conversation.
  if (countQuestions(input.history) >= (options.maxQuestions ?? MAX_QUESTIONS))
    messages.push({ role: "user", content: QUESTION_LIMIT_NOTE });
  return {
    system: options.system,
    messages,
    ...(input.screenshotPng ? { images: [{ png: input.screenshotPng }] } : {}),
    outputSchema: TURN_JSON_SCHEMA,
  };
};

export interface RunTurnOptions extends ModelRequestOptions {
  readonly model: ModelAdapter;
  readonly input: TurnInput;
  readonly signal?: AbortSignal;
}

/**
 * One intake turn: calls the model and parses its reply. Throws IntakeUnavailable when the model
 * gives no usable turn, including a question after the limit (that would keep the report in intake
 * forever). Any error the adapter throws other than IntakeUnavailable becomes "gateway". Once
 * `signal` is aborted, the signal's reason is thrown instead.
 */
export const runTurn = async (options: RunTurnOptions): Promise<Turn> => {
  const request = buildModelRequest(options.input, options);
  let raw: string;
  try {
    raw = await options.model.complete(
      options.signal ? { ...request, signal: options.signal } : request,
    );
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (isIntakeUnavailable(error)) throw error;
    throw new IntakeUnavailable("gateway", { cause: error });
  }
  const turn = typeof raw === "string" ? parseTurn(raw) : null;
  if (!turn) throw new IntakeUnavailable("invalid_output");
  if (
    turn.kind === "question" &&
    countQuestions(options.input.history) >= (options.maxQuestions ?? MAX_QUESTIONS)
  )
    throw new IntakeUnavailable("invalid_output");
  return turn;
};

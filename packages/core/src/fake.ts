import { IntakeUnavailable } from "./errors.ts";
import { DEFAULT_LANGUAGES, QUESTION_LIMIT_NOTE, REPORTER_WROTE } from "./request.ts";
import type { IntakeUnavailableReason, ModelAdapter, ModelRequest, Turn } from "./types.ts";

/** One scripted reply: a turn (sent as JSON), raw text, an Error to throw, or a function. */
export type FakeStep =
  | Turn
  | string
  | Error
  | ((request: ModelRequest) => Turn | string | Promise<Turn | string>);

export interface FakeModel extends ModelAdapter {
  /** Every request received, oldest first. */
  readonly requests: ReadonlyArray<ModelRequest>;
}

const SCRIPTED: Readonly<
  Record<
    string,
    {
      readonly question: string;
      readonly summary: (first: string, answer: string) => string;
    }
  >
> = {
  et: {
    question: "Mis peaks seal õigesti olema?",
    summary: (first, answer) => `Kokkuvõte: ${first} Õige oleks: ${answer}. Kas see on õige?`,
  },
  en: {
    question: "What should be shown there instead?",
    summary: (first, answer) => `Summary: ${first} It should be: ${answer}. Is this right?`,
  },
  fi: {
    question: "Mitä siinä pitäisi näkyä?",
    summary: (first, answer) => `Yhteenveto: ${first} Oikein olisi: ${answer}. Onko tämä oikein?`,
  },
  ru: {
    question: "Что должно отображаться вместо этого?",
    summary: (first, answer) => `Итог: ${first} Должно быть: ${answer}. Всё верно?`,
  },
};

const FAKE_PUBLIC_SUMMARY = "A user reported a problem on this screen.";
const CONTEXT_MARKER = "Captured context (JSON):\n";
const QUESTIONS = new Set(Object.values(SCRIPTED).map((text) => text.question));

/**
 * The scripted agent's reply, read from the request alone (the format buildModelRequest writes):
 * - language: the "Reporter's language: <English name>." line of the first message, mapped back
 *   through the default language table (English when unknown);
 * - first sentence: what follows "The reporter wrote: " after the context JSON;
 * - questions asked: assistant messages equal to one of the scripted questions;
 * - answer: the latest user message other than the question-limit note.
 * It asks one question, then summarises the first sentence and the latest answer.
 */
const scriptedTurn = (request: ModelRequest): Turn => {
  const first = request.messages[0]?.content ?? "";
  const name = /^Reporter's language: (.*)\.$/m.exec(first)?.[1];
  const language =
    Object.entries(DEFAULT_LANGUAGES).find(([, english]) => english === name)?.[0] ?? "en";
  const text = SCRIPTED[language] ?? SCRIPTED.en!;
  const contextAt = first.indexOf(CONTEXT_MARKER);
  const wroteAt = first.indexOf(`\n\n${REPORTER_WROTE}`, Math.max(contextAt, 0));
  const sentence = wroteAt >= 0 ? first.slice(wroteAt + 2 + REPORTER_WROTE.length) : first;
  const asked = request.messages.some(
    (message) => message.role === "assistant" && QUESTIONS.has(message.content),
  );
  if (!asked) return { kind: "question", text: text.question };
  const later = request.messages
    .slice(1)
    .filter((message) => message.role === "user" && message.content !== QUESTION_LIMIT_NOTE);
  const answer = later.at(-1)?.content ?? sentence;
  return {
    kind: "summary",
    text: text.summary(sentence, answer),
    summary: {
      title: sentence.slice(0, 80),
      kind: "other",
      expected: answer,
      actual: sentence,
      steps: [],
      publicSummary: FAKE_PUBLIC_SUMMARY,
    },
  };
};

/**
 * A model for tests and for development without an API key.
 *
 * With no script it is a scripted agent: one question, then a summary, in English, Estonian,
 * Finnish or Russian. With a script, each call consumes the next step; a call after the last step
 * throws. Either way `requests` records what it received.
 */
export const createFakeModel = (script?: ReadonlyArray<FakeStep>): FakeModel => {
  const requests: Array<ModelRequest> = [];
  let next = 0;
  return {
    requests,
    async complete(request) {
      requests.push(request);
      if (!script) return JSON.stringify(scriptedTurn(request));
      if (next >= script.length) throw new Error("Fake model script is exhausted");
      const step = script[next++]!;
      if (step instanceof Error) throw step;
      const reply = typeof step === "function" ? await step(request) : step;
      return typeof reply === "string" ? reply : JSON.stringify(reply);
    },
  };
};

/** A model that is never available. Every report is submitted as written. */
export const unavailableModel = (
  reason: IntakeUnavailableReason = "not_configured",
): ModelAdapter => ({
  complete: async () => {
    throw new IntakeUnavailable(reason);
  },
});

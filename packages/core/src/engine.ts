// The stateless building blocks createIntake is made of, for hosts that run turns themselves
// (a queue worker, a custom conversation loop) and for adapter authors. Most hosts need only
// createIntake from "@elicitor/core".
export {
  DEFAULT_GLOSSARY_HEADING,
  DEFAULT_PUBLIC_SUMMARY_RULES,
  DEFAULT_REPRODUCIBLE_WHEN,
} from "./prompt.ts";
export {
  buildModelRequest,
  countQuestions,
  DEFAULT_LANGUAGE,
  MAX_CONTEXT_CHARS,
  MAX_REGION_TEXT_ENTRIES,
  type ModelRequestOptions,
  QUESTION_LIMIT_NOTE,
  REPORTER_WROTE,
  type RunTurnOptions,
  resolveLanguage,
  runTurn,
} from "./request.ts";
export { isSummary, isTurn, parseTurn, TURN_JSON_SCHEMA } from "./turn.ts";

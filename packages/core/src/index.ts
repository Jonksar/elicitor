// The host-facing surface: the intake, its two contracts (ModelAdapter, ReportStore) and the wire
// types. Test doubles live in "@elicitor/core/testing"; the stateless single-turn building blocks
// in "@elicitor/core/engine".
export {
  ElicitorError,
  IntakeUnavailable,
  isElicitorError,
  isIntakeUnavailable,
} from "./errors.ts";
export { unavailableModel } from "./fake.ts";
export {
  createIntake,
  DEFAULT_UNAVAILABLE_NOTES,
  type Intake,
  type IntakeOptions,
  type TurnCallOptions,
  type UnavailableInfo,
} from "./intake.ts";
export {
  createMemoryStore,
  type MemoryStore,
  type MemoryStoreOptions,
  pendingSummaryOf,
} from "./memory-store.ts";
export { buildSystemPrompt, type SystemPromptOptions } from "./prompt.ts";
export { DEFAULT_LANGUAGES } from "./request.ts";
export {
  createMemoryRoadmap,
  type MemoryRoadmap,
  type MemoryRoadmapOptions,
} from "./roadmap.ts";
export { MAX_QUESTIONS } from "./turn.ts";
export type * from "./types.ts";

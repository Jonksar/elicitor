import type { ElicitorErrorCode, IntakeUnavailableReason } from "./types.ts";

// Registered symbols, so a check still works when two copies of this package are loaded.
const INTAKE_UNAVAILABLE = Symbol.for("@elicitor/core/IntakeUnavailable");
const ELICITOR_ERROR = Symbol.for("@elicitor/core/ElicitorError");

const REASONS: ReadonlyArray<IntakeUnavailableReason> = [
  "not_configured",
  "gateway",
  "refusal",
  "invalid_output",
];
const CODES: ReadonlyArray<ElicitorErrorCode> = ["not_found", "invalid", "stale"];

/**
 * The model could not produce a usable turn. Core then submits the report as the reporter wrote
 * it. Model adapters throw this; any other error an adapter throws is treated as "gateway".
 */
export class IntakeUnavailable extends Error {
  readonly reason: IntakeUnavailableReason;

  constructor(reason: IntakeUnavailableReason, options?: { readonly cause?: unknown }) {
    super(
      `Intake unavailable: ${reason}`,
      options && "cause" in options ? { cause: options.cause } : undefined,
    );
    this.name = "IntakeUnavailable";
    this.reason = reason;
    Object.defineProperty(this, INTAKE_UNAVAILABLE, { value: true });
  }
}

/** A request core refused: the report does not exist, the input is invalid, or it is stale. */
export class ElicitorError extends Error {
  readonly code: ElicitorErrorCode;

  constructor(code: ElicitorErrorCode, message?: string) {
    super(message ?? `Elicitor: ${code}`);
    this.name = "ElicitorError";
    this.code = code;
    Object.defineProperty(this, ELICITOR_ERROR, { value: true });
  }
}

const branded = (value: unknown, brand: symbol): value is Record<PropertyKey, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as Record<PropertyKey, unknown>)[brand] === true;

/** True for an IntakeUnavailable from any copy of @elicitor/core. */
export const isIntakeUnavailable = (error: unknown): error is IntakeUnavailable =>
  error instanceof IntakeUnavailable ||
  (branded(error, INTAKE_UNAVAILABLE) && REASONS.includes(error.reason as IntakeUnavailableReason));

/** True for an ElicitorError from any copy of @elicitor/core. */
export const isElicitorError = (error: unknown): error is ElicitorError =>
  error instanceof ElicitorError ||
  (branded(error, ELICITOR_ERROR) && CODES.includes(error.code as ElicitorErrorCode));

const TRANSPORT_ERROR = Symbol.for("@elicitor/react/ElicitorTransportError");
const ACTION_ERROR = Symbol.for("@elicitor/react/ElicitorActionError");

/**
 * A transport request failed. `status` is the HTTP status (0 when no response arrived), `code` the
 * machine-readable reason: the server's `{ error: { code } }`, or "network" / "invalid_response"
 * when the transport itself could not complete. null when the server sent no code.
 */
export class ElicitorTransportError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(
    status: number,
    code: string | null,
    message?: string,
    options?: { readonly cause?: unknown },
  ) {
    super(
      message ?? (code ? `Elicitor request failed: ${code}` : `Elicitor request failed: ${status}`),
      options && "cause" in options ? { cause: options.cause } : undefined,
    );
    this.name = "ElicitorTransportError";
    this.status = status;
    this.code = code;
    Object.defineProperty(this, TRANSPORT_ERROR, { value: true });
  }
}

/** True for an ElicitorTransportError from any copy of this package. */
export const isElicitorTransportError = (error: unknown): error is ElicitorTransportError =>
  error instanceof ElicitorTransportError ||
  (typeof error === "object" &&
    error !== null &&
    (error as Record<PropertyKey, unknown>)[TRANSPORT_ERROR] === true);

/**
 * Why a hook refused an action without calling the transport:
 * - "no_report": no report is loaded;
 * - "not_allowed": the host's canReply / canConfirm / canWithdraw is false;
 * - "no_pending_summary": confirm() while the report has no pendingSummarySeq;
 * - "busy": another request that blocks this one is in flight;
 * - "empty": the text is empty after trimming;
 * - "invalid_step": the flow is not in the step this action needs.
 */
export type ElicitorActionErrorCode =
  | "no_report"
  | "not_allowed"
  | "no_pending_summary"
  | "busy"
  | "empty"
  | "invalid_step";

/** A hook action was refused before any request was made. Never stored in hook state. */
export class ElicitorActionError extends Error {
  readonly code: ElicitorActionErrorCode;

  constructor(code: ElicitorActionErrorCode, message?: string) {
    super(message ?? `Elicitor action refused: ${code}`);
    this.name = "ElicitorActionError";
    this.code = code;
    Object.defineProperty(this, ACTION_ERROR, { value: true });
  }
}

/** True for an ElicitorActionError from any copy of this package. */
export const isElicitorActionError = (error: unknown): error is ElicitorActionError =>
  error instanceof ElicitorActionError ||
  (typeof error === "object" &&
    error !== null &&
    (error as Record<PropertyKey, unknown>)[ACTION_ERROR] === true);

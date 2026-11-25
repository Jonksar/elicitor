/**
 * Public types of @elicitor/core. Every other package builds on these shapes.
 * Zero runtime code lives here except the IntakeUnavailable and ElicitorError classes in errors.ts.
 */

// ---------------------------------------------------------------------------------------------
// Report data
// ---------------------------------------------------------------------------------------------

export type ReportStatus =
  | "intake"
  | "submitted"
  | "in_progress"
  | "needs_reply"
  | "fixed"
  | "closed"
  | "withdrawn";

export type MessageAuthor = "reporter" | "agent" | "fixer" | "system";

export type SummaryKind = "figure" | "screen" | "error" | "other";

/** The marked rectangle in CSS pixels, with the viewport it was drawn in. */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/** One request the host application made (the host pushes these; at most 50 are kept). */
export interface RequestLogEntry {
  readonly tag: string;
  readonly startedAt: string;
  readonly ms: number;
  readonly outcome: "ok" | "error";
  readonly errorTag?: string;
  readonly message?: string;
}

/** One console error or unhandled rejection (at most 30 are kept). */
export interface ConsoleErrorEntry {
  readonly at: string;
  readonly message: string;
  readonly stack?: string;
}

export interface CaptureContext {
  readonly language: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly userAgent: string;
  readonly bundleId: string;
  readonly requestLog: ReadonlyArray<RequestLogEntry>;
  readonly consoleErrors: ReadonlyArray<ConsoleErrorEntry>;
}

/** The agent's structured description of the problem, read back to the reporter. */
export interface Summary {
  readonly title: string;
  readonly kind: SummaryKind;
  readonly expected: string;
  readonly actual: string;
  readonly steps: ReadonlyArray<string>;
  /** Safe for a public tracker: no customer data. */
  readonly publicSummary: string;
}

/** One agent turn: a follow-up question, or a summary for the reporter to confirm. */
export type Turn =
  | { readonly kind: "question"; readonly text: string }
  | { readonly kind: "summary"; readonly text: string; readonly summary: Summary };

// ---------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------

export interface ModelMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ModelRequest {
  /** Byte-stable system prompt; adapters should mark it cacheable. */
  readonly system: string;
  /** Oldest first. The first message is always a user message carrying the capture. */
  readonly messages: ReadonlyArray<ModelMessage>;
  /** Base64 PNGs; adapters attach them to the FIRST user message, before its text. */
  readonly images?: ReadonlyArray<{ readonly png: string }>;
  /** JSON Schema the reply should follow (TURN_JSON_SCHEMA). */
  readonly outputSchema: object;
  readonly signal?: AbortSignal;
}

/**
 * A model provider. Returns the model's raw text; core parses it.
 * Throws IntakeUnavailable("gateway" | "refusal" | "not_configured") when no usable text exists.
 */
export interface ModelAdapter {
  complete(request: ModelRequest): Promise<string>;
}

export type IntakeUnavailableReason = "not_configured" | "gateway" | "refusal" | "invalid_output";

// ---------------------------------------------------------------------------------------------
// One turn (stateless engine)
// ---------------------------------------------------------------------------------------------

/** What was captured when the report was started. `context` is passed to the model as JSON. */
export interface Capture {
  /** Reporter's language code, e.g. "en". Unknown codes fall back to the default language. */
  readonly language: string;
  readonly route: string;
  readonly regionText: ReadonlyArray<string>;
  readonly context: unknown;
  readonly screenshotPng: string | null;
}

export interface HistoryEntry {
  readonly author: "reporter" | "agent";
  readonly body: string;
  /** For agent entries: which kind of turn it was. null for reporter entries. */
  readonly kind: "question" | "summary" | null;
}

export interface TurnInput extends Capture {
  /** Oldest first; the first entry is the reporter's opening sentence. */
  readonly history: ReadonlyArray<HistoryEntry>;
}

// ---------------------------------------------------------------------------------------------
// Store (the host owns persistence, authorisation and encryption)
// ---------------------------------------------------------------------------------------------

export interface StoredMessage {
  readonly seq: number;
  readonly author: MessageAuthor;
  readonly body: string;
  /** The parsed turn for agent messages, else null. */
  readonly turn: Turn | null;
  readonly createdAt: string;
}

export interface StoredReport {
  readonly id: string;
  readonly status: ReportStatus;
  readonly title: string | null;
  /** Ordered by seq, starting at 1 with the reporter's sentence. */
  readonly messages: ReadonlyArray<StoredMessage>;
  /** The confirmed summary, once the reporter accepted one. */
  readonly summary: Summary | null;
  readonly createdAt: string;
  readonly statusChangedAt: string;
}

export interface NewReport extends Capture {
  readonly sentence: string;
  readonly region?: Region | null;
  /** Opaque host data (tenant, user, ...). Core never reads it. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** What an intake turn ended with. */
export type TurnOutcome =
  | { readonly kind: "turn"; readonly turn: Turn }
  /** The agent was unavailable: append `note` as a system message and move to "submitted". */
  | {
      readonly kind: "unavailable";
      readonly note: string;
      readonly reason: IntakeUnavailableReason;
    };

/**
 * Persistence contract. Every mutating method must be ATOMIC (one transaction / compare-and-set):
 * core never does check-then-write across calls. Errors a store throws pass through core unchanged,
 * so the host can report "unavailable" without the fallback path running.
 */
export interface ReportStore {
  /**
   * Creates the report in status "intake" with the sentence as message seq 1. Needed by
   * `intake.start()` only: hosts that create rows themselves omit it and call `intake.advance()`.
   */
  create?(input: NewReport): Promise<{ readonly id: string; readonly seq: number }>;
  get(id: string): Promise<StoredReport | null>;
  /** The capture saved at creation; null when the report does not exist. */
  loadCapture(id: string): Promise<Capture | null>;
  /** Appends a reporter message only while the report is in intake. */
  appendReporterMessage(
    id: string,
    body: string,
  ): Promise<
    | { readonly ok: true; readonly seq: number }
    | { readonly ok: false; readonly reason: "not_found" | "not_intake" }
  >;
  /**
   * Applies a turn outcome only if the report is still in intake AND its latest message seq equals
   * `expectedSeq`. Returns false (and writes nothing) otherwise: the report was withdrawn or the
   * reporter has written again, so the late answer is dropped.
   */
  commitTurn(id: string, expectedSeq: number, outcome: TurnOutcome): Promise<boolean>;
  /**
   * Confirms the pending summary: only while in intake, when the LATEST message is an agent summary
   * whose seq equals `expectedSeq`. Sets status "submitted", stores the summary and its title.
   */
  confirm(id: string, expectedSeq: number): Promise<"confirmed" | "stale" | "not_found">;
  /** Allowed from "intake" and "submitted" only. */
  withdraw(id: string): Promise<"withdrawn" | "not_allowed" | "not_found">;
}

export type ElicitorErrorCode = "not_found" | "invalid" | "stale";

// ---------------------------------------------------------------------------------------------
// Wire types (what a UI transport exchanges with the host backend)
// ---------------------------------------------------------------------------------------------

export interface ReportListItem {
  readonly id: string;
  /** Human-facing number, when the host has one. */
  readonly number?: number;
  readonly status: ReportStatus;
  readonly title: string | null;
  readonly sentence: string;
  readonly createdAt: string;
  readonly statusChangedAt: string;
  readonly unread: boolean;
}

export interface ReportDetail extends ReportListItem {
  readonly route: string;
  readonly region: Region | null;
  readonly messages: ReadonlyArray<{
    readonly seq: number;
    readonly author: MessageAuthor;
    readonly body: string;
    readonly createdAt: string;
  }>;
  /** Base64 PNG, or null when the host does not return it. */
  readonly screenshotPng: string | null;
  /** The agent's latest summary while the reporter has not confirmed it (status intake). */
  readonly pendingSummary: Summary | null;
  readonly pendingSummarySeq: number | null;
  readonly summary: Summary | null;
  /** Decided by the host: only the report's owner may act. The UI hides controls accordingly. */
  readonly canReply: boolean;
  readonly canConfirm: boolean;
  readonly canWithdraw: boolean;
  /**
   * Decided by the host: the viewer is the person who filed the report. The UI labels the
   * reporter's messages "You" when true and "Reporter" otherwise.
   */
  readonly viewerIsReporter: boolean;
}

export interface CreateReportInput {
  readonly sentence: string;
  readonly route: string;
  readonly region?: Region;
  readonly regionText: ReadonlyArray<string>;
  readonly context: CaptureContext;
  /** Base64 PNG. */
  readonly screenshotPng: string;
  /** Opaque host data sent along (for example the selected tenant). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** How the UI reaches the host backend. `id` is ReportListItem.id. */
export interface ElicitorTransport {
  create(input: CreateReportInput): Promise<ReportListItem>;
  list(): Promise<ReadonlyArray<ReportListItem>>;
  get(id: string): Promise<ReportDetail>;
  reply(id: string, body: string): Promise<ReportDetail>;
  confirm(id: string, expectedSeq: number): Promise<ReportDetail>;
  withdraw(id: string): Promise<void>;
}

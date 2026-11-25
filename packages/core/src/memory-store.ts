import type {
  Capture,
  NewReport,
  Region,
  ReportDetail,
  ReportListItem,
  ReportStatus,
  ReportStore,
  StoredMessage,
  StoredReport,
  Summary,
} from "./types.ts";

/** The agent's latest summary while the reporter has not confirmed it: the last message, in intake. */
export const pendingSummaryOf = (
  messages: ReadonlyArray<StoredMessage>,
  status: ReportStatus,
): { readonly summary: Summary; readonly seq: number } | null => {
  if (status !== "intake") return null;
  const last = messages.at(-1);
  return last?.author === "agent" && last.turn?.kind === "summary"
    ? { summary: last.turn.summary, seq: last.seq }
    : null;
};

export interface MemoryStoreOptions {
  /** ISO timestamp source. Default: the current time. */
  readonly now?: () => string;
  /** Report id source. Default: crypto.randomUUID(). */
  readonly newId?: () => string;
}

export interface MemoryStore extends ReportStore {
  /** Newest first. `filter` sees the metadata the report was created with. */
  list(filter?: (metadata: Readonly<Record<string, unknown>>) => boolean): Array<ReportListItem>;
  toListItem(id: string): ReportListItem | null;
  /** The wire detail. `canAct` is the host's decision that the viewer owns the report. */
  toDetail(id: string, options: { readonly canAct: boolean }): ReportDetail | null;
  /** The reporter has seen the report as it is now; clears `unread`. */
  markSeen(id: string): void;
  /** Moves a report to any status, for hosts that run the fixer side. */
  setStatus(id: string, status: ReportStatus): boolean;
  metadataOf(id: string): Readonly<Record<string, unknown>> | null;
}

interface Row {
  report: StoredReport;
  readonly number: number;
  readonly capture: Capture;
  readonly region: Region | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  seenAt: string | null;
}

/**
 * A complete ReportStore in memory, for tests, demos and development. Each mutating method checks
 * and writes synchronously, so it is atomic within one JavaScript realm. Reads return copies.
 */
export const createMemoryStore = (options: MemoryStoreOptions = {}): MemoryStore => {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const rows = new Map<string, Row>();
  let lastNumber = 0;

  const append = (row: Row, message: Omit<StoredMessage, "seq" | "createdAt">): number => {
    const seq = (row.report.messages.at(-1)?.seq ?? 0) + 1;
    row.report = {
      ...row.report,
      messages: [...row.report.messages, { ...message, seq, createdAt: now() }],
    };
    return seq;
  };
  const move = (row: Row, status: ReportStatus, changes: Partial<StoredReport> = {}): void => {
    row.report = { ...row.report, ...changes, status, statusChangedAt: now() };
  };
  const listItem = (row: Row): ReportListItem => ({
    id: row.report.id,
    number: row.number,
    status: row.report.status,
    title: row.report.title,
    sentence: row.report.messages[0]?.body ?? "",
    createdAt: row.report.createdAt,
    statusChangedAt: row.report.statusChangedAt,
    unread: row.seenAt === null || row.report.statusChangedAt > row.seenAt,
  });

  return {
    async create(input: NewReport) {
      let id = newId();
      while (rows.has(id)) id = newId();
      const at = now();
      rows.set(id, {
        number: ++lastNumber,
        capture: structuredClone({
          language: input.language,
          route: input.route,
          regionText: input.regionText,
          context: input.context,
          screenshotPng: input.screenshotPng,
        }),
        region: input.region ? { ...input.region } : null,
        metadata: { ...input.metadata },
        seenAt: null,
        report: {
          id,
          status: "intake",
          title: input.sentence.slice(0, 80),
          messages: [
            { seq: 1, author: "reporter", body: input.sentence, turn: null, createdAt: at },
          ],
          summary: null,
          createdAt: at,
          statusChangedAt: at,
        },
      });
      return { id, seq: 1 };
    },

    async get(id) {
      const row = rows.get(id);
      return row ? structuredClone(row.report) : null;
    },

    async loadCapture(id) {
      const row = rows.get(id);
      return row ? structuredClone(row.capture) : null;
    },

    async appendReporterMessage(id, body) {
      const row = rows.get(id);
      if (!row) return { ok: false, reason: "not_found" };
      if (row.report.status !== "intake") return { ok: false, reason: "not_intake" };
      return { ok: true, seq: append(row, { author: "reporter", body, turn: null }) };
    },

    async commitTurn(id, expectedSeq, outcome) {
      const row = rows.get(id);
      if (row?.report.status !== "intake") return false;
      if (row.report.messages.at(-1)?.seq !== expectedSeq) return false;
      if (outcome.kind === "turn") {
        const turn = structuredClone(outcome.turn);
        append(row, { author: "agent", body: turn.text, turn });
      } else {
        append(row, { author: "system", body: outcome.note, turn: null });
        move(row, "submitted");
      }
      return true;
    },

    async confirm(id, expectedSeq) {
      const row = rows.get(id);
      if (!row) return "not_found";
      const pending = pendingSummaryOf(row.report.messages, row.report.status);
      if (!pending || pending.seq !== expectedSeq) return "stale";
      move(row, "submitted", {
        summary: pending.summary,
        title: pending.summary.title.slice(0, 200),
      });
      return "confirmed";
    },

    async withdraw(id) {
      const row = rows.get(id);
      if (!row) return "not_found";
      if (row.report.status !== "intake" && row.report.status !== "submitted") return "not_allowed";
      move(row, "withdrawn");
      return "withdrawn";
    },

    list(filter) {
      return [...rows.values()]
        .filter((row) => !filter || filter(row.metadata))
        .sort((a, b) =>
          a.report.createdAt === b.report.createdAt
            ? b.number - a.number
            : a.report.createdAt < b.report.createdAt
              ? 1
              : -1,
        )
        .map(listItem);
    },

    toListItem(id) {
      const row = rows.get(id);
      return row ? listItem(row) : null;
    },

    toDetail(id, { canAct }) {
      const row = rows.get(id);
      if (!row) return null;
      const { report } = row;
      const pending = pendingSummaryOf(report.messages, report.status);
      const open = report.status === "intake" || report.status === "submitted";
      return structuredClone({
        ...listItem(row),
        route: row.capture.route,
        region: row.region,
        messages: report.messages.map(({ seq, author, body, createdAt }) => ({
          seq,
          author,
          body,
          createdAt,
        })),
        screenshotPng: row.capture.screenshotPng,
        pendingSummary: pending?.summary ?? null,
        pendingSummarySeq: pending?.seq ?? null,
        summary: report.summary,
        canReply: canAct && report.status === "intake",
        canConfirm: canAct && pending !== null,
        canWithdraw: canAct && open,
      });
    },

    markSeen(id) {
      const row = rows.get(id);
      if (row) row.seenAt = now();
    },

    setStatus(id, status) {
      const row = rows.get(id);
      if (!row) return false;
      move(row, status);
      return true;
    },

    metadataOf(id) {
      const row = rows.get(id);
      return row ? { ...row.metadata } : null;
    },
  };
};

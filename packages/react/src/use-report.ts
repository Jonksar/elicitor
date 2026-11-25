import type { ReportDetail } from "@elicitor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ElicitorActionError } from "./errors.ts";
import { type LoadStatus, useElicitorInternal } from "./provider.tsx";

export type ReportAction = "reply" | "confirm" | "withdraw";

export interface ReportState {
  /** The report for the current id; null before the first load and for a null id. */
  readonly report: ReportDetail | null;
  /**
   * "idle" for a null id, "loading" until the first load for this id settles, "ready" after a
   * successful load or action, "error" when the last load failed (`report` keeps the last value).
   * A refresh with a report shown does not go back to "loading".
   */
  readonly status: LoadStatus;
  /** The last load or action error; cleared when a new request starts. */
  readonly error: unknown;
  /** What `error` came from. */
  readonly failed: "load" | ReportAction | null;
  /** The action in flight, if any (always the newest request's). */
  readonly pending: ReportAction | null;
  /** Straight from the report (false without one). The host decides ownership. */
  readonly canReply: boolean;
  readonly canConfirm: boolean;
  readonly canWithdraw: boolean;
  /** Sends an answer or correction. Refused while any action is pending. */
  reply(body: string): Promise<ReportDetail>;
  /** Confirms with report.pendingSummarySeq. Refused while any action is pending. */
  confirm(): Promise<ReportDetail>;
  /** Withdraws, then reloads the report. Allowed while a reply or confirm is pending. */
  withdraw(): Promise<void>;
  /** Reloads the report. Never rejects. Does nothing while a reply or confirm is pending. */
  refresh(): Promise<void>;
}

interface Stored {
  readonly id: string | null;
  readonly report: ReportDetail | null;
  readonly status: LoadStatus;
  readonly error: unknown;
  readonly failed: ReportState["failed"];
  readonly pending: ReportAction | null;
}

const fresh = (id: string | null): Stored => ({
  id,
  report: null,
  status: id === null ? "idle" : "loading",
  error: null,
  failed: null,
  pending: null,
});

/**
 * One report and the reporter's actions on it. Every load and action takes a ticket; a response
 * is applied only while its ticket is the newest and the id is unchanged, so a late response never
 * overwrites a newer one, and nothing is applied after unmount.
 */
export const useReport = (id: string | null): ReportState => {
  const { api, patchListItem, reportError } = useElicitorInternal("useReport");
  const transportRef = useRef(api.transport);
  transportRef.current = api.transport;
  const idRef = useRef(id);
  idRef.current = id;

  const [stored, setStored] = useState<Stored>(() => fresh(id));
  const storedRef = useRef(stored);
  const ticket = useRef(0);
  const mounted = useRef(false);

  const update = useCallback((patch: Partial<Stored>) => {
    storedRef.current = { ...storedRef.current, ...patch };
    setStored(storedRef.current);
  }, []);

  /** The stored state for the current id (a fresh one between an id change and its effect). */
  const view = (): Stored =>
    storedRef.current.id === idRef.current ? storedRef.current : fresh(idRef.current);

  const begin = (pending: ReportAction | null): number => {
    const next = ++ticket.current;
    update({ ...view(), pending, error: null, failed: null });
    return next;
  };
  const isCurrent = (t: number): boolean => mounted.current && ticket.current === t;

  const load = async (target: string | null): Promise<void> => {
    if (target === null) {
      ticket.current++;
      update(fresh(null));
      return;
    }
    const t = begin(null);
    if (!storedRef.current.report) update({ status: "loading" });
    try {
      const report = await transportRef.current.get(target);
      if (!isCurrent(t)) return;
      update({ report, status: "ready" });
      patchListItem(report);
    } catch (error) {
      if (!isCurrent(t)) return;
      update({ status: "error", error, failed: "load" });
      reportError(error);
    }
  };

  const loaded = (): { id: string; report: ReportDetail; state: Stored } => {
    const state = view();
    const target = idRef.current;
    if (target === null || !state.report)
      throw new ElicitorActionError("no_report", "No report is loaded");
    return { id: target, report: state.report, state };
  };

  const act = async (
    action: "reply" | "confirm",
    request: () => Promise<ReportDetail>,
  ): Promise<ReportDetail> => {
    const t = begin(action);
    try {
      const report = await request();
      if (isCurrent(t)) {
        update({ report, status: "ready", pending: null });
        patchListItem(report);
      }
      return report;
    } catch (error) {
      if (isCurrent(t)) {
        update({ pending: null, error, failed: action });
        reportError(error);
      }
      throw error;
    }
  };

  const reply = async (body: string): Promise<ReportDetail> => {
    const { id: target, report, state } = loaded();
    if (!report.canReply) throw new ElicitorActionError("not_allowed", "canReply is false");
    if (state.pending !== null)
      throw new ElicitorActionError("busy", `${state.pending} is pending`);
    const text = body.trim();
    if (!text) throw new ElicitorActionError("empty", "The reply is empty");
    return act("reply", () => transportRef.current.reply(target, text));
  };

  const confirm = async (): Promise<ReportDetail> => {
    const { id: target, report, state } = loaded();
    if (!report.canConfirm) throw new ElicitorActionError("not_allowed", "canConfirm is false");
    const seq = report.pendingSummarySeq;
    if (seq === null)
      throw new ElicitorActionError("no_pending_summary", "The report has no pending summary");
    if (state.pending !== null)
      throw new ElicitorActionError("busy", `${state.pending} is pending`);
    return act("confirm", () => transportRef.current.confirm(target, seq));
  };

  const withdraw = async (): Promise<void> => {
    const { id: target, report, state } = loaded();
    if (!report.canWithdraw) throw new ElicitorActionError("not_allowed", "canWithdraw is false");
    if (state.pending === "withdraw") throw new ElicitorActionError("busy", "withdraw is pending");
    const t = begin("withdraw");
    try {
      await transportRef.current.withdraw(target);
    } catch (error) {
      if (isCurrent(t)) {
        update({ pending: null, error, failed: "withdraw" });
        reportError(error);
      }
      throw error;
    }
    if (!isCurrent(t)) return;
    try {
      const next = await transportRef.current.get(target);
      if (!isCurrent(t)) return;
      update({ report: next, status: "ready", pending: null });
      patchListItem(next);
    } catch (error) {
      if (!isCurrent(t)) return;
      // The withdraw itself succeeded; only the reload failed.
      update({ pending: null, status: "error", error, failed: "load" });
      reportError(error);
    }
  };

  // The functions above read refs only; stable wrappers keep their identity across renders.
  // A reload during a reply or confirm could show a snapshot from before the agent's turn and
  // would drop the action's answer, so it is skipped; the action's response is the fresh state.
  const refresh = async (): Promise<void> => {
    const { pending } = view();
    if (pending === "reply" || pending === "confirm") return;
    await load(idRef.current);
  };

  const actions = useRef({ load, reply, confirm, withdraw, refresh });
  actions.current = { load, reply, confirm, withdraw, refresh };
  const stable = useMemo(
    () => ({
      reply: (body: string) => actions.current.reply(body),
      confirm: () => actions.current.confirm(),
      withdraw: () => actions.current.withdraw(),
      refresh: () => actions.current.refresh(),
    }),
    [],
  );

  useEffect(() => {
    mounted.current = true;
    void actions.current.load(id);
    return () => {
      mounted.current = false;
      ticket.current++;
    };
  }, [id]);

  const shown = stored.id === id ? stored : fresh(id);
  return useMemo<ReportState>(
    () => ({
      report: shown.report,
      status: shown.status,
      error: shown.error,
      failed: shown.failed,
      pending: shown.pending,
      canReply: shown.report?.canReply ?? false,
      canConfirm: shown.report?.canConfirm ?? false,
      canWithdraw: shown.report?.canWithdraw ?? false,
      ...stable,
    }),
    [shown, stable],
  );
};

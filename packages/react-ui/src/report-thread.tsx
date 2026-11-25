import type { ReportDetail, Summary } from "@elicitor/core";
import { isElicitorTransportError, useReport } from "@elicitor/react";
import { type ReactElement, useId, useState } from "react";
import { type ColorScheme, Notice, rootProps, StatusBadge, submitOnModEnter } from "./parts.tsx";
import { type MessagesApi, useMessages } from "./use-messages.ts";

export interface SummaryConfirmProps {
  /** The report whose summary is shown: the pending one, else the confirmed one. */
  readonly report: ReportDetail;
  /** Shown as the confirm button only while `report.canConfirm` and a summary is pending. */
  readonly onConfirm?: () => void;
  /** Shown as the "correct it" button only while `report.canReply` and a summary is pending. */
  readonly onCorrect?: () => void;
  /** Disables the buttons (a request is in flight). */
  readonly busy?: boolean;
  readonly colorScheme?: ColorScheme;
  readonly className?: string;
}

function SummaryFields({
  summary,
  m,
}: {
  readonly summary: Summary;
  readonly m: MessagesApi;
}): ReactElement {
  return (
    <dl className="el-fields">
      <div>
        <dt>{m.t("kind")}</dt>
        <dd>{m.kind(summary.kind)}</dd>
      </div>
      <div>
        <dt>{m.t("actual")}</dt>
        <dd>{summary.actual}</dd>
      </div>
      <div>
        <dt>{m.t("expected")}</dt>
        <dd>{summary.expected}</dd>
      </div>
      {summary.steps.length > 0 && (
        <div>
          <dt>{m.t("steps")}</dt>
          <dd>
            <ol>
              {summary.steps.map((step, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: steps are plain text and may repeat
                <li key={index}>{step}</li>
              ))}
            </ol>
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * The assistant's structured summary read back to the reporter. While it is pending, the owner
 * confirms it, or corrects it by replying in the thread: a reply produces a new summary.
 */
export function SummaryConfirm(props: SummaryConfirmProps): ReactElement | null {
  const { report, onConfirm, onCorrect, busy = false, colorScheme = "system", className } = props;
  const m = useMessages();
  const titleId = useId();
  const pending = report.pendingSummary;
  const summary = pending ?? report.summary;
  if (!summary) return null;
  const canConfirm = pending !== null && report.canConfirm && onConfirm !== undefined;
  const canCorrect = pending !== null && report.canReply && onCorrect !== undefined;
  return (
    <section
      {...rootProps(colorScheme, className, "el-summary")}
      aria-labelledby={titleId}
      data-pending={pending ? "" : undefined}
    >
      {pending && <p className="el-eyebrow">{m.t("summaryTitle")}</p>}
      <h3 id={titleId} className="el-summary-title">
        {summary.title}
      </h3>
      <SummaryFields summary={summary} m={m} />
      {(canConfirm || canCorrect) && (
        <div className="el-actions">
          {canConfirm && (
            <button
              type="button"
              className="el-btn"
              data-variant="primary"
              disabled={busy}
              onClick={onConfirm}
            >
              {m.t("confirm")}
            </button>
          )}
          {canCorrect && (
            <button
              type="button"
              className="el-btn"
              data-variant="quiet"
              disabled={busy}
              onClick={onCorrect}
            >
              {m.t("correct")}
            </button>
          )}
        </div>
      )}
      {canCorrect && <p className="el-hint">{m.t("correctHint")}</p>}
    </section>
  );
}

export interface ReportThreadProps {
  readonly reportId: string;
  /**
   * Who is looking: "reporter" labels the reporter's messages "You", "other" labels them
   * "Reporter". Controls follow the report's canReply / canConfirm / canWithdraw either way.
   */
  readonly viewer?: "reporter" | "other";
  readonly colorScheme?: ColorScheme;
  readonly className?: string;
}

const actionError = (error: unknown, failed: string | null, m: MessagesApi): string | null => {
  if (failed === "reply") return m.t("replyFailed");
  if (failed === "withdraw") return m.t("withdrawFailed");
  if (failed === "confirm")
    return isElicitorTransportError(error) && error.code === "stale"
      ? m.t("stale")
      : m.t("confirmFailed");
  return null;
};

/** The thread without its own root: shared by <ReportThread> and the widget's panel. */
export function ThreadBody({
  reportId,
  viewer = "reporter",
  headingId,
  colorScheme,
}: {
  readonly reportId: string;
  readonly viewer?: "reporter" | "other";
  readonly headingId?: string;
  /** The enclosing root's scheme; the summary card is its own root and must match it. */
  readonly colorScheme: ColorScheme;
}): ReactElement {
  const m = useMessages();
  const state = useReport(reportId);
  const { report, status, error, failed, pending } = state;
  const [draft, setDraft] = useState("");

  const fieldId = useId();
  const hintId = useId();
  const ownId = useId();
  const titleId = headingId ?? ownId;

  if (!report) {
    if (status === "error") {
      const notFound = isElicitorTransportError(error) && error.code === "not_found";
      return (
        <div className="el-thread">
          <h2 id={titleId} className="el-visually-hidden">
            {m.t(notFound ? "notFound" : "loadReportFailed")}
          </h2>
          <Notice
            kind="error"
            action={
              notFound ? undefined : (
                <button type="button" className="el-link" onClick={() => void state.refresh()}>
                  {m.t("retry")}
                </button>
              )
            }
          >
            {m.t(notFound ? "notFound" : "loadReportFailed")}
          </Notice>
        </div>
      );
    }
    return (
      <div className="el-thread">
        <h2 id={titleId} className="el-visually-hidden">
          {m.t("loading")}
        </h2>
        <p className="el-loading" role="status">
          {m.t("loading")}
        </p>
      </div>
    );
  }

  const send = () => {
    const body = draft.trim();
    if (!body || pending !== null || !report.canReply) return;
    state.reply(body).then(
      () => setDraft(""),
      () => {},
    );
  };
  const summaryPending = report.pendingSummary !== null;
  const replyError = actionError(error, failed, m);
  const authorLabel = (author: ReportDetail["messages"][number]["author"]): string =>
    author === "reporter" && viewer === "other" ? m.t("otherReporter") : m.t(author);
  const reported =
    report.number !== undefined ? m.t("reportNumber", { number: report.number }) : null;
  // The summary turn is shown as the structured card in its place in the log: the pending one,
  // or after confirmation the last agent message (confirm needs the summary to be the latest).
  const summarySeq =
    report.pendingSummarySeq ??
    (report.summary
      ? ([...report.messages].reverse().find((msg) => msg.author === "agent")?.seq ?? null)
      : null);

  return (
    <div className="el-thread" aria-busy={pending !== null || undefined}>
      <header className="el-thread-head">
        <div className="el-thread-meta">
          {reported && <span>{reported}</span>}
          <time dateTime={report.createdAt}>{m.date(report.createdAt)}</time>
        </div>
        <h2 id={titleId} className="el-thread-title">
          {report.title || report.sentence}
        </h2>
        <p className="el-thread-status">
          <span className="el-visually-hidden">{m.t("status")}: </span>
          <StatusBadge status={report.status} label={m.status(report.status)} />
        </p>
      </header>

      <ol className="el-log" role="log" aria-live="polite" aria-labelledby={titleId}>
        {report.messages.map((message) =>
          message.seq === summarySeq ? (
            <li key={message.seq} className="el-msg-summary">
              <SummaryConfirm
                report={report}
                colorScheme={colorScheme}
                busy={pending !== null}
                onConfirm={() => void state.confirm().catch(() => {})}
              />
            </li>
          ) : (
            <li key={message.seq} className="el-msg" data-author={message.author}>
              <span className="el-msg-author">{authorLabel(message.author)}</span>
              <p className="el-msg-body">{message.body}</p>
            </li>
          ),
        )}
        {pending === "reply" && (
          <li className="el-msg" data-author="agent" data-thinking="">
            <span className="el-msg-author">{m.t("agent")}</span>
            <p className="el-msg-body">
              <span className="el-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {m.t("thinking")}
            </p>
          </li>
        )}
      </ol>

      {report.status === "submitted" && report.canWithdraw && (
        <div className="el-sent" role="status">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.14" />
            <path
              d="M6 10.5l2.5 2.5L14 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <p className="el-sent-title">{m.t("sentTitle")}</p>
            <p className="el-hint">{m.t("sentBody", { list: m.t("list") })}</p>
          </div>
        </div>
      )}

      {replyError && <Notice kind="error">{replyError}</Notice>}
      {status === "error" && failed === "load" && (
        <Notice
          kind="error"
          action={
            <button type="button" className="el-link" onClick={() => void state.refresh()}>
              {m.t("retry")}
            </button>
          }
        >
          {m.t("loadReportFailed")}
        </Notice>
      )}

      {report.canReply && (
        <div className="el-reply">
          <label htmlFor={fieldId} className="el-label">
            {m.t(summaryPending ? "correct" : "answer")}
          </label>
          {summaryPending && (
            <p id={hintId} className="el-hint">
              {m.t("correctHint")}
            </p>
          )}
          <textarea
            id={fieldId}
            className="el-textarea"
            rows={2}
            maxLength={2000}
            value={draft}
            readOnly={pending === "reply" || pending === "confirm"}
            aria-describedby={summaryPending ? hintId : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={submitOnModEnter(send)}
          />

          <div className="el-actions" data-align="end">
            <button
              type="button"
              className="el-btn"
              data-variant={summaryPending ? "secondary" : "primary"}
              disabled={pending !== null || !draft.trim()}
              onClick={send}
            >
              {m.t("reply")}
            </button>
          </div>
        </div>
      )}

      {report.canWithdraw && (
        <div className="el-thread-foot">
          <button
            type="button"
            className="el-link"
            data-tone="danger"
            disabled={pending === "withdraw"}
            onClick={() => void state.withdraw().catch(() => {})}
          >
            {m.t("withdraw")}
          </button>
        </div>
      )}
    </div>
  );
}

/** One report: its messages, the reply box, the pending summary with confirm, and withdraw. */
export function ReportThread(props: ReportThreadProps): ReactElement {
  const { reportId, viewer, colorScheme = "system", className } = props;
  return (
    <div {...rootProps(colorScheme, className, "el-standalone")}>
      <ThreadBody
        key={reportId}
        reportId={reportId}
        colorScheme={colorScheme}
        {...(viewer ? { viewer } : {})}
      />
    </div>
  );
}

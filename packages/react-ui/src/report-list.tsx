import type { ReportListItem } from "@elicitor/core";
import { useElicitor } from "@elicitor/react";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";
import { type ColorScheme, Notice, rootProps, StatusBadge } from "./parts.tsx";
import { useMessages } from "./use-messages.ts";

export interface ReportListProps {
  /** Called with the report id when a row is chosen. Without it the rows are not interactive. */
  readonly onSelect?: (id: string) => void;
  /** Marks this row as the current one. */
  readonly selectedId?: string | null;
  readonly colorScheme?: ColorScheme;
  readonly className?: string;
}

/**
 * The reporter's own reports, newest first: status, unread marker, title (or the first sentence)
 * and date. Loads the list on mount. A row opened from here stops showing as unread at once.
 */
export function ReportList(props: ReportListProps): ReactElement {
  const { onSelect, selectedId = null, colorScheme = "system", className } = props;
  const m = useMessages();
  const { reports, flow } = useElicitor();
  const headingId = useId();
  // statusChangedAt of each row when it was opened here: newer activity shows as unread again.
  const [opened, setOpened] = useState<ReadonlyMap<string, string>>(new Map());
  const { refresh } = reports;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The report open in the widget's panel is being read; reload once the panel closes so the
  // server's seen state shows.
  const shownInPanel = flow.step === "thread" ? flow.reportId : null;
  const wasInPanel = useRef<string | null>(null);
  const items = useRef(reports.items);
  items.current = reports.items;
  useEffect(() => {
    const closed = wasInPanel.current;
    wasInPanel.current = shownInPanel;
    if (closed === null || shownInPanel !== null) return;
    const item = items.current.find((entry) => entry.id === closed);
    if (item) setOpened((current) => new Map(current).set(item.id, item.statusChangedAt));
    void refresh();
  }, [shownInPanel, refresh]);

  const isUnread = (item: ReportListItem): boolean =>
    item.unread &&
    opened.get(item.id) !== item.statusChangedAt &&
    item.id !== selectedId &&
    item.id !== shownInPanel;

  const select = (item: ReportListItem) => {
    setOpened((current) => new Map(current).set(item.id, item.statusChangedAt));
    onSelect?.(item.id);
  };

  let body: ReactElement;
  if (reports.status === "error" && reports.items.length === 0) {
    body = (
      <Notice
        kind="error"
        action={
          <button type="button" className="el-link" onClick={() => void refresh()}>
            {m.t("retry")}
          </button>
        }
      >
        {m.t("loadFailed")}
      </Notice>
    );
  } else if (reports.items.length === 0) {
    body =
      reports.status === "ready" ? (
        <p className="el-empty">{m.t("empty")}</p>
      ) : (
        <p className="el-loading" role="status">
          {m.t("loading")}
        </p>
      );
  } else {
    body = (
      <ul className="el-list" aria-labelledby={headingId}>
        {reports.items.map((item) => {
          const unread = isUnread(item);
          const content = (
            <>
              <span className="el-row-main">
                <span className="el-row-title">
                  {unread && (
                    <span className="el-unread">
                      <span className="el-visually-hidden">{m.t("unread")}</span>
                    </span>
                  )}
                  <span className="el-row-text">{item.title || item.sentence}</span>
                </span>
                <span className="el-row-meta">
                  {item.number !== undefined && <span>#{item.number}</span>}
                  <time dateTime={item.createdAt}>{m.date(item.createdAt)}</time>
                </span>
              </span>
              <StatusBadge status={item.status} label={m.status(item.status)} />
            </>
          );
          return (
            <li key={item.id} data-unread={unread ? "" : undefined}>
              {onSelect ? (
                <button
                  type="button"
                  className="el-row"
                  aria-current={item.id === selectedId ? "true" : undefined}
                  onClick={() => select(item)}
                >
                  {content}
                </button>
              ) : (
                <div className="el-row">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section {...rootProps(colorScheme, className, "el-standalone")} aria-labelledby={headingId}>
      <h2 id={headingId} className="el-section-title">
        {m.t("list")}
      </h2>
      {reports.status === "error" && reports.items.length > 0 && (
        <Notice kind="error">{m.t("loadFailed")}</Notice>
      )}
      {body}
    </section>
  );
}

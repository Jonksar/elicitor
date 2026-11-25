import type { ReportListItem } from "@elicitor/core";
import { useElicitor } from "@elicitor/react";
import {
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { type ColorScheme, Notice, rootProps, StatusBadge } from "./parts.tsx";
import type { RenderError } from "./report-thread.tsx";
import { useMessages } from "./use-messages.ts";

/** What `renderRow` gets besides the item. */
export interface ReportRowState {
  /** Shown as unread (a newer state than the reporter has seen). */
  readonly unread: boolean;
  /** The row is `selectedId`. */
  readonly selected: boolean;
  /** `getHref(item)`, when given. */
  readonly href: string | undefined;
  /** Marks the row as read here and calls `onSelect`. */
  select(): void;
  /** The default row content (title, number, date and status), for wrapping in your own element. */
  readonly content: ReactNode;
}

export interface ReportListProps {
  /**
   * Called with the report id when a row is chosen. Without it (and without `getHref`) the rows
   * are not interactive.
   */
  readonly onSelect?: (id: string) => void;
  /**
   * Renders each row as a link to this address. A plain click still calls `onSelect` (and does not
   * navigate when `onSelect` is given, so a client-side router can); a modified or middle click
   * behaves like any link.
   */
  readonly getHref?: (item: ReportListItem) => string;
  /** Replaces the row element inside each `<li>`. */
  readonly renderRow?: (item: ReportListItem, row: ReportRowState) => ReactNode;
  /** The host's message for a failed list load, instead of the default notice. */
  readonly renderError?: RenderError;
  /** Marks this row as the current one. */
  readonly selectedId?: string | null;
  readonly colorScheme?: ColorScheme;
  readonly className?: string;
}

/** A click a link should handle itself: new tab or window, download, another button. */
const isModifiedClick = (event: MouseEvent): boolean =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * The reporter's own reports, newest first: status, unread marker, title (or the first sentence)
 * and date. Loads the list on mount. A row opened from here stops showing as unread at once.
 */
export function ReportList(props: ReportListProps): ReactElement {
  const {
    onSelect,
    getHref,
    renderRow,
    renderError,
    selectedId = null,
    colorScheme = "system",
    className,
  } = props;
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

  const markOpened = (item: ReportListItem) =>
    setOpened((current) => new Map(current).set(item.id, item.statusChangedAt));
  const select = (item: ReportListItem) => {
    markOpened(item);
    onSelect?.(item.id);
  };
  const retry = () => void refresh();
  const loadError = (fallback: () => ReactNode): ReactNode => {
    const custom = renderError?.(reports.error, retry);
    return custom === null || custom === undefined ? fallback() : custom;
  };

  let body: ReactNode;
  if (reports.status === "error" && reports.items.length === 0) {
    body = loadError(() => (
      <Notice
        kind="error"
        action={
          <button type="button" className="el-link" onClick={retry}>
            {m.t("retry")}
          </button>
        }
      >
        {m.t("loadFailed")}
      </Notice>
    ));
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
          const selected = item.id === selectedId;
          const href = getHref?.(item);
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
          let row: ReactNode;
          if (renderRow) {
            row = renderRow(item, { unread, selected, href, select: () => select(item), content });
          } else if (href !== undefined) {
            row = (
              <a
                className="el-row"
                href={href}
                aria-current={selected ? "true" : undefined}
                onClick={(event) => {
                  markOpened(item);
                  if (!onSelect || isModifiedClick(event)) return;
                  event.preventDefault();
                  onSelect(item.id);
                }}
              >
                {content}
              </a>
            );
          } else if (onSelect) {
            row = (
              <button
                type="button"
                className="el-row"
                aria-current={selected ? "true" : undefined}
                onClick={() => select(item)}
              >
                {content}
              </button>
            );
          } else {
            row = <div className="el-row">{content}</div>;
          }
          return (
            <li key={item.id} data-unread={unread ? "" : undefined}>
              {row}
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
      {reports.status === "error" &&
        reports.items.length > 0 &&
        loadError(() => <Notice kind="error">{m.t("loadFailed")}</Notice>)}
      {body}
    </section>
  );
}

import type { ReportListItem } from "@elicitor/core";
import { useElicitor } from "@elicitor/react";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  CloseButton,
  type ColorScheme,
  canTakeFocus,
  Dialog,
  Notice,
  rootProps,
  submitOnModEnter,
} from "./parts.tsx";
import { ThreadBody } from "./report-thread.tsx";
import { useMessages } from "./use-messages.ts";

export type ElicitorPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface TriggerApi {
  /** Starts the region select with the widget's localised overlay texts. */
  open(): void;
  /**
   * True while the region select runs or a report is being sent; `open()` does nothing then. The
   * default trigger is disabled meanwhile.
   */
  readonly busy: boolean;
}

export interface ElicitorProps {
  /**
   * Default: a floating button. A node replaces the floating button's content; a function renders
   * your own trigger in place (no floating wrapper); `null` renders none, so the host opens the
   * widget with `useElicitor().open()`.
   */
  readonly trigger?: ReactNode | ((api: TriggerApi) => ReactNode);
  /** Corner of the floating button and the thread panel. Default "bottom-right". */
  readonly position?: ElicitorPosition;
  /** Default "system" (follows prefers-color-scheme). */
  readonly colorScheme?: ColorScheme;
  readonly className?: string;
  /** Called with the new report once the sentence was sent. */
  readonly onSubmitted?: (report: ReportListItem) => void;
  /**
   * Show the new report's thread in the widget's panel after sending. Default true. With false
   * the widget closes instead, for hosts that open their own report page from `onSubmitted`.
   */
  readonly openThreadAfterSubmit?: boolean;
}

function TriggerIcon(): ReactElement {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V5A1.5 1.5 0 0 1 4 3.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 6.5v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="12.25" r="1" fill="currentColor" />
    </svg>
  );
}

function ComposeDialog({
  colorScheme,
  className,
  onSend,
  returnFocus,
}: {
  readonly colorScheme: ColorScheme;
  readonly className: string | undefined;
  readonly onSend: (sentence: string) => void;
  readonly returnFocus: () => HTMLElement | null;
}): ReactElement {
  const m = useMessages();
  const { flow, close } = useElicitor();
  const [sentence, setSentence] = useState("");
  const titleId = useId();
  const hintId = useId();
  const sending = flow.step === "submitting";
  const screenshot = flow.capture?.screenshotPng ?? "";
  const send = () => {
    if (sending || !sentence.trim()) return;
    onSend(sentence);
  };
  return (
    <div {...rootProps(colorScheme, className, "el-backdrop", true)}>
      <Dialog
        modal
        labelledBy={titleId}
        describedBy={hintId}
        onClose={close}
        className="el-dialog"
        colorScheme={colorScheme}
        busy={sending}
        returnFocus={returnFocus}
      >
        <header className="el-dialog-head">
          <h2 id={titleId} className="el-dialog-title">
            {m.t("sentence")}
          </h2>
          <CloseButton label={m.t("close")} onClick={close} />
        </header>
        {screenshot && (
          <img
            className="el-shot"
            src={`data:image/png;base64,${screenshot}`}
            alt={m.t("screenshot")}
          />
        )}
        <textarea
          data-autofocus
          className="el-textarea"
          aria-labelledby={titleId}
          aria-describedby={hintId}
          rows={3}
          required
          maxLength={2000}
          value={sentence}
          readOnly={sending}
          onChange={(event) => setSentence(event.target.value)}
          onKeyDown={submitOnModEnter(send)}
        />
        <p id={hintId} className="el-hint">
          {m.t("sentenceHint")}
        </p>
        {flow.error !== null && <Notice kind="error">{m.t("failed")}</Notice>}
        <div className="el-actions" data-align="end">
          <button
            type="button"
            className="el-btn"
            data-variant="secondary"
            disabled={sending}
            onClick={close}
          >
            {m.t("cancel")}
          </button>
          <button
            type="button"
            className="el-btn"
            data-variant="primary"
            disabled={sending || !sentence.trim()}
            onClick={send}
          >
            {sending ? m.t("sending") : m.t("send")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function ThreadPanel({
  reportId,
  position,
  colorScheme,
}: {
  readonly reportId: string;
  readonly position: ElicitorPosition;
  readonly colorScheme: ColorScheme;
}): ReactElement {
  const m = useMessages();
  const { close } = useElicitor();
  const headingId = useId();
  const body = useRef<HTMLDivElement>(null);
  // Keep the newest turn in view, as a chat does: follow every change to the thread's content.
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    const follow = () => {
      node.scrollTop = node.scrollHeight;
    };
    const observer = new MutationObserver(follow);
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    follow();
    return () => observer.disconnect();
  }, []);
  return (
    <Dialog
      modal={false}
      labelledBy={headingId}
      onClose={close}
      className="el-panel"
      colorScheme={colorScheme}
    >
      <div className="el-panel-bar" data-position={position}>
        <CloseButton label={m.t("close")} onClick={close} />
      </div>
      <div ref={body} className="el-panel-body">
        <ThreadBody
          key={reportId}
          reportId={reportId}
          headingId={headingId}
          colorScheme={colorScheme}
        />
      </div>
    </Dialog>
  );
}

/**
 * The drop-in widget: a trigger, the region select, the one-sentence dialog and the thread panel
 * (questions, replies, summary read-back, confirm). Use it inside <ElicitorProvider>.
 */
export function Elicitor(props: ElicitorProps): ReactElement {
  const { trigger, position = "bottom-right", colorScheme = "system", className } = props;
  const m = useMessages();
  const { flow, open: openFlow, close, submit } = useElicitor();
  const { overlayLabels } = m;
  const busy = flow.step === "selecting" || flow.step === "submitting";
  const latest = useRef(props);
  latest.current = props;
  // What had focus when the flow opened (normally the trigger). The default trigger is disabled
  // while busy, so focus handed back to it then is lost; it is restored from here instead.
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback(() => {
    const active = document.activeElement;
    opener.current = canTakeFocus(active) ? active : null;
    void openFlow({ labels: overlayLabels }).catch(() => {});
  }, [openFlow, overlayLabels]);
  const returnFocus = useCallback(() => (opener.current?.isConnected ? opener.current : null), []);
  const send = useCallback(
    (sentence: string) => {
      const openThread = latest.current.openThreadAfterSubmit !== false;
      submit(sentence, { openThread }).then(
        (report) => latest.current.onSubmitted?.(report),
        () => {},
      );
    },
    [submit],
  );
  // A cancelled or failed region select hands focus back while the trigger is still disabled.
  const previousStep = useRef(flow.step);
  useEffect(() => {
    const before = previousStep.current;
    previousStep.current = flow.step;
    if (before !== "selecting" || flow.step !== "idle") return;
    if (canTakeFocus(document.activeElement)) return;
    const target = returnFocus();
    if (canTakeFocus(target)) target.focus();
  }, [flow.step, returnFocus]);

  let triggerNode: ReactNode = null;
  if (typeof trigger === "function") {
    triggerNode = trigger({ open, busy });
  } else if (trigger !== null) {
    triggerNode = createPortal(
      <div {...rootProps(colorScheme, className, "el-fab", true)} data-position={position}>
        <button
          type="button"
          className="el-trigger"
          aria-haspopup="dialog"
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={open}
        >
          {trigger === undefined ? (
            <>
              <TriggerIcon />
              <span className="el-trigger-text">{m.t("report")}</span>
            </>
          ) : (
            trigger
          )}
        </button>
      </div>,
      document.body,
    );
  }

  const composing = flow.step === "composing" || flow.step === "submitting";
  return (
    <>
      {triggerNode}
      {composing &&
        createPortal(
          <ComposeDialog
            colorScheme={colorScheme}
            className={className}
            onSend={send}
            returnFocus={returnFocus}
          />,
          document.body,
        )}
      {flow.step === "thread" &&
        flow.reportId !== null &&
        createPortal(
          <div {...rootProps(colorScheme, className, "el-dock", true)} data-position={position}>
            <ThreadPanel reportId={flow.reportId} position={position} colorScheme={colorScheme} />
          </div>,
          document.body,
        )}
      {flow.step === "idle" &&
        flow.error !== null &&
        createPortal(
          <div {...rootProps(colorScheme, className, "el-dock", true)} data-position={position}>
            <div className="el-toast">
              <Notice kind="error" action={<CloseButton label={m.t("close")} onClick={close} />}>
                {m.t("captureFailed")}
              </Notice>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

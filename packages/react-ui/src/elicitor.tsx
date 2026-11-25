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
  /** True while the region select runs or a report is being sent. */
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
}: {
  readonly colorScheme: ColorScheme;
  readonly className: string | undefined;
}): ReactElement {
  const m = useMessages();
  const { flow, submit, close } = useElicitor();
  const [sentence, setSentence] = useState("");
  const titleId = useId();
  const hintId = useId();
  const sending = flow.step === "submitting";
  const screenshot = flow.capture?.screenshotPng ?? "";
  const send = () => {
    if (sending || !sentence.trim()) return;
    void submit(sentence).catch(() => {});
  };
  return (
    <div {...rootProps(colorScheme, className, "el-backdrop")}>
      <Dialog
        modal
        labelledBy={titleId}
        describedBy={hintId}
        onClose={close}
        className="el-dialog"
        colorScheme={colorScheme}
        busy={sending}
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
  const { flow, open: openFlow, close } = useElicitor();
  const { overlayLabels } = m;
  const busy = flow.step === "selecting" || flow.step === "submitting";
  const open = useCallback(() => {
    void openFlow({ labels: overlayLabels }).catch(() => {});
  }, [openFlow, overlayLabels]);
  // The trigger stays enabled while busy (open() is a no-op then) so focus can return to it.

  let triggerNode: ReactNode = null;
  if (typeof trigger === "function") {
    triggerNode = trigger({ open, busy });
  } else if (trigger !== null) {
    triggerNode = createPortal(
      <div {...rootProps(colorScheme, className, "el-fab")} data-position={position}>
        <button
          type="button"
          className="el-trigger"
          aria-haspopup="dialog"
          aria-busy={busy || undefined}
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
          <ComposeDialog colorScheme={colorScheme} className={className} />,
          document.body,
        )}
      {flow.step === "thread" &&
        flow.reportId !== null &&
        createPortal(
          <div {...rootProps(colorScheme, className, "el-dock")} data-position={position}>
            <ThreadPanel reportId={flow.reportId} position={position} colorScheme={colorScheme} />
          </div>,
          document.body,
        )}
      {flow.step === "idle" &&
        flow.error !== null &&
        createPortal(
          <div {...rootProps(colorScheme, className, "el-dock")} data-position={position}>
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

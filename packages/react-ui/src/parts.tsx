import type { ReportStatus } from "@elicitor/core";
import { type KeyboardEvent, type ReactElement, type ReactNode, useEffect, useRef } from "react";

export type ColorScheme = "light" | "dark" | "system";

/** Props every widget root carries: the scope class, the capture exclusion and the scheme. */
export const rootProps = (
  colorScheme: ColorScheme,
  className: string | undefined,
  extra?: string,
): {
  className: string;
  "data-elicitor-ui": "";
  "data-elicitor-scheme": ColorScheme;
} => ({
  className: ["elicitor", extra, className].filter(Boolean).join(" "),
  "data-elicitor-ui": "",
  "data-elicitor-scheme": colorScheme,
});

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

const focusables = (node: HTMLElement): HTMLElement[] =>
  Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );

export interface DialogProps {
  /** Modal dialogs trap focus and get `aria-modal`. */
  readonly modal: boolean;
  readonly labelledBy: string;
  readonly describedBy?: string;
  readonly onClose: () => void;
  readonly className: string;
  readonly colorScheme: ColorScheme;
  readonly busy?: boolean;
  readonly children: ReactNode;
}

/**
 * A dialog: focus moves in on mount (to `[data-autofocus]` or the dialog itself) and back to the
 * previously focused element on unmount; Escape calls onClose; a modal one keeps Tab inside.
 */
export function Dialog(props: DialogProps): ReactElement {
  const { modal, labelledBy, describedBy, className, colorScheme, busy, children } = props;
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    (node?.querySelector<HTMLElement>("[data-autofocus]") ?? node)?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      onClose.current();
      return;
    }
    if (!modal || event.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === ref.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={ref}
      {...rootProps(colorScheme, className)}
      role="dialog"
      aria-modal={modal ? "true" : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

export function StatusBadge({
  status,
  label,
}: {
  readonly status: ReportStatus;
  readonly label: string;
}): ReactElement {
  return (
    <span className="el-badge" data-status={status}>
      {label}
    </span>
  );
}

export function Notice({
  kind = "info",
  children,
  action,
}: {
  readonly kind?: "info" | "error";
  readonly children: ReactNode;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <div className="el-notice" data-kind={kind} role={kind === "error" ? "alert" : "status"}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function CloseButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="el-icon-btn"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/** Sends on Cmd/Ctrl+Enter. */
export const submitOnModEnter =
  (send: () => void) =>
  (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  };

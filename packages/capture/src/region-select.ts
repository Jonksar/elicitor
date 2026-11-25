import type { Region } from "@elicitor/core";
import { captureScreenshot, collectRegionText, UI_ATTRIBUTE } from "./capture.ts";

export interface RegionSelectLabels {
  hint: string;
  wholeView: string;
  cancel: string;
}

export interface RegionSelectOptions {
  /** English defaults. */
  labels?: Partial<RegionSelectLabels>;
  /** Default true; false => screenshotPng is "" and modern-screenshot is never loaded. */
  screenshot?: boolean;
  /** Default true; false => regionText is []. */
  regionText?: boolean;
  /** Default 200 entries; each entry is capped at 500 characters. */
  maxRegionText?: number;
  /** Default: CSS variable --elicitor-z, falling back to 2147483000. */
  zIndex?: number;
  /** Aborting resolves null. */
  signal?: AbortSignal;
}

export interface CaptureResult {
  /** null = the whole viewport was chosen. */
  region: Region | null;
  /** Base64 PNG without the data: prefix. */
  screenshotPng: string;
  regionText: string[];
}

const DEFAULT_LABELS: RegionSelectLabels = {
  hint: "Drag over the part of the screen with the problem, or press Enter to use the whole view.",
  wholeView: "Use whole view",
  cancel: "Cancel",
};

const ACCENT = "var(--elicitor-accent, #dc2626)";
const STYLES = `[data-elicitor-overlay]{position:fixed;inset:0;z-index:var(--elicitor-z,2147483000);cursor:crosshair;background:var(--elicitor-overlay,rgba(15,23,42,.4));touch-action:none;outline:none}
[data-elicitor-hint]{position:absolute;top:24px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:min(600px,calc(100% - 32px));padding:16px;border-radius:8px;background:Canvas;color:CanvasText;text-align:center;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.2);cursor:default}
[data-elicitor-hint] p{margin:0 0 12px}
[data-elicitor-hint] button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid ${ACCENT};cursor:pointer}
[data-elicitor-hint] button:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
[data-elicitor-whole-view]{background:${ACCENT};color:#fff}
[data-elicitor-cancel]{margin-left:8px;background:transparent;color:inherit}
[data-elicitor-region]{position:absolute;box-sizing:border-box;border:2px solid ${ACCENT};background:rgba(255,255,255,.25);pointer-events:none}`;

const clampPoint = (x: number, y: number) => ({
  x: Math.max(0, Math.min(window.innerWidth, x)),
  y: Math.max(0, Math.min(window.innerHeight, y)),
});

const isOnButton = (target: EventTarget | null) =>
  target instanceof Element && target.closest("button") !== null;

const button = (label: string, attribute: string) => {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.setAttribute(attribute, "");
  return element;
};

/**
 * Dims the page and lets the user drag a rectangle. Enter or the whole-view button chooses the whole
 * viewport. Resolves null when cancelled (Escape / cancel / abort). The overlay is removed before
 * anything is captured.
 */
export function startRegionSelect(
  options: RegionSelectOptions = {},
): Promise<CaptureResult | null> {
  const { signal } = options;
  if (signal?.aborted) return Promise.resolve(null);
  const labels: RegionSelectLabels = { ...DEFAULT_LABELS, ...options.labels };

  return new Promise<CaptureResult | null>((resolve, reject) => {
    const style = document.createElement("style");
    style.setAttribute("data-elicitor-capture", "");
    style.textContent = STYLES;

    const overlay = document.createElement("div");
    overlay.setAttribute(UI_ATTRIBUTE, "");
    overlay.setAttribute("data-elicitor-overlay", "");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", labels.hint);
    overlay.tabIndex = -1;
    if (options.zIndex !== undefined) overlay.style.zIndex = String(options.zIndex);

    const help = document.createElement("div");
    help.setAttribute("data-elicitor-hint", "");
    const hint = document.createElement("p");
    hint.textContent = labels.hint;
    const wholeView = button(labels.wholeView, "data-elicitor-whole-view");
    const cancelButton = button(labels.cancel, "data-elicitor-cancel");
    help.append(hint, wholeView, cancelButton);

    const marker = document.createElement("div");
    marker.setAttribute("data-elicitor-region", "");
    marker.hidden = true;
    overlay.append(help, marker);

    let start: { x: number; y: number } | null = null;
    let region: Region | null = null;
    let finished = false;
    const previousFocus = document.activeElement;

    const rectangle = (x: number, y: number): Region => {
      const end = clampPoint(x, y),
        from = start ?? end;
      return {
        x: Math.min(from.x, end.x),
        y: Math.min(from.y, end.y),
        width: Math.abs(end.x - from.x),
        height: Math.abs(end.y - from.y),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    };
    const draw = (next: Region | null) => {
      region = next;
      marker.hidden = next === null;
      if (!next) return;
      marker.style.left = `${next.x}px`;
      marker.style.top = `${next.y}px`;
      marker.style.width = `${next.width}px`;
      marker.style.height = `${next.height}px`;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (event.key === "Enter") {
        if (isOnButton(event.target)) return;
        event.preventDefault();
        confirm(region && region.width > 0 && region.height > 0 ? region : null);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isOnButton(event.target)) return;
      try {
        overlay.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic or already-released pointers cannot be captured; the drag still works.
      }
      start = clampPoint(event.clientX, event.clientY);
      draw(null);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (start) draw(rectangle(event.clientX, event.clientY));
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!start) return;
      const next = rectangle(event.clientX, event.clientY);
      start = null;
      if (next.width > 0 && next.height > 0) confirm(next);
      else draw(null);
    };
    const onWholeView = () => confirm(null);
    const onAbort = () => {
      if (!finished) cancel();
      else resolve(null);
    };

    const cleanup = () => {
      overlay.removeEventListener("keydown", onKeyDown);
      overlay.removeEventListener("pointerdown", onPointerDown);
      overlay.removeEventListener("pointermove", onPointerMove);
      overlay.removeEventListener("pointerup", onPointerUp);
      wholeView.removeEventListener("click", onWholeView);
      cancelButton.removeEventListener("click", cancel);
      overlay.remove();
      style.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
    function cancel() {
      if (finished) return;
      finished = true;
      cleanup();
      signal?.removeEventListener("abort", onAbort);
      resolve(null);
    }
    function confirm(chosen: Region | null) {
      if (finished) return;
      finished = true;
      cleanup();
      const finish = (result: CaptureResult | null) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(signal?.aborted ? null : result);
      };
      const text =
        options.regionText === false ? [] : collectRegionText(chosen, options.maxRegionText);
      if (options.screenshot === false) {
        finish({ region: chosen, screenshotPng: "", regionText: text });
        return;
      }
      captureScreenshot(chosen).then(
        (screenshotPng) => finish({ region: chosen, screenshotPng, regionText: text }),
        (error: unknown) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    }

    overlay.addEventListener("keydown", onKeyDown);
    overlay.addEventListener("pointerdown", onPointerDown);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerup", onPointerUp);
    wholeView.addEventListener("click", onWholeView);
    cancelButton.addEventListener("click", cancel);
    signal?.addEventListener("abort", onAbort);

    document.head.append(style);
    document.body.append(overlay);
    overlay.focus();
  });
}

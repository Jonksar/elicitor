import type { CaptureContext, ConsoleErrorEntry, RequestLogEntry } from "@elicitor/core";

/**
 * Browser facts sent with a report. Logs are copied; nothing is read that the host did not pass.
 * `userAgent: false` sends an empty user agent.
 */
export function collectContext(
  options: {
    bundleId?: string;
    language?: string;
    requestLog?: ReadonlyArray<RequestLogEntry>;
    consoleErrors?: ReadonlyArray<ConsoleErrorEntry>;
    userAgent?: boolean;
  } = {},
): CaptureContext {
  return {
    language: options.language ?? (document.documentElement.lang || navigator.language),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    userAgent: options.userAgent === false ? "" : navigator.userAgent,
    bundleId: options.bundleId ?? "",
    requestLog: [...(options.requestLog ?? [])],
    consoleErrors: [...(options.consoleErrors ?? [])],
  };
}

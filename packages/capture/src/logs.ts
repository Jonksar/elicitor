import type { ConsoleErrorEntry, RequestLogEntry } from "@elicitor/core";

const MAX_TEXT_LENGTH = 2000;

export interface ConsoleErrorBuffer {
  /** Starts recording. Returns an uninstall that restores console.error and removes the listeners. */
  install(): () => void;
  /** A copy, oldest first. */
  entries(): ConsoleErrorEntry[];
  clear(): void;
}

export interface RequestLog {
  push(entry: RequestLogEntry): void;
  /** A copy, oldest first. */
  entries(): RequestLogEntry[];
  clear(): void;
}

const text = (value: unknown): string =>
  (value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : String(value)
  ).slice(0, MAX_TEXT_LENGTH);

/**
 * Keeps the latest `limit` console errors, window errors and unhandled rejections.
 * Only the first console.error argument is recorded; messages and stacks are cut to 2000 characters.
 */
export function createConsoleErrorBuffer(limit = 30): ConsoleErrorBuffer {
  const buffer: ConsoleErrorEntry[] = [];
  let uninstall: (() => void) | null = null;
  const record = (value: unknown) => {
    buffer.push({
      at: new Date().toISOString(),
      message: text(value),
      ...(value instanceof Error && value.stack
        ? { stack: value.stack.slice(0, MAX_TEXT_LENGTH) }
        : {}),
    });
    while (buffer.length > limit) buffer.shift();
  };
  return {
    install() {
      if (uninstall) return uninstall;
      const original = console.error;
      let active = true;
      const wrapped = (...args: unknown[]) => {
        if (active) record(args[0]);
        original.apply(console, args);
      };
      console.error = wrapped;
      const onError = (event: ErrorEvent) => record(event.error ?? event.message);
      const onRejection = (event: PromiseRejectionEvent) => record(event.reason);
      const target = typeof window === "undefined" ? null : window;
      target?.addEventListener("error", onError);
      target?.addEventListener("unhandledrejection", onRejection);
      const remove = () => {
        if (uninstall !== remove) return;
        uninstall = null;
        active = false;
        if (console.error === wrapped) console.error = original;
        target?.removeEventListener("error", onError);
        target?.removeEventListener("unhandledrejection", onRejection);
      };
      uninstall = remove;
      return remove;
    },
    entries: () => [...buffer],
    clear() {
      buffer.length = 0;
    },
  };
}

/** Keeps the latest `limit` request summaries the host pushes. */
export function createRequestLog(limit = 50): RequestLog {
  const log: RequestLogEntry[] = [];
  return {
    push(entry) {
      log.push(entry);
      while (log.length > limit) log.shift();
    },
    entries: () => [...log],
    clear() {
      log.length = 0;
    },
  };
}

// Shared by the browser tests only; not exported from the package.
import type { CaptureContext, ReportListItem } from "@elicitor/core";
import { ElicitorProvider, type ElicitorProviderProps } from "@elicitor/react";
import type { MemoryTransport } from "@elicitor/react/testing";
import type { ReactElement, ReactNode } from "react";

export const CONTEXT: CaptureContext = {
  language: "en",
  viewport: { width: 800, height: 600 },
  userAgent: "",
  bundleId: "",
  requestLog: [],
  consoleErrors: [],
};

/** Creates a report straight through the transport (no UI). */
export const createReport = (
  transport: MemoryTransport,
  sentence: string,
  language = "en",
): Promise<ReportListItem> =>
  transport.create({
    sentence,
    route: "/",
    regionText: [],
    context: { ...CONTEXT, language },
    screenshotPng: "",
  });

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

export const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** A provider with fast capture defaults for tests (no screenshot, no console buffer). */
export function TestProvider(
  props: Omit<ElicitorProviderProps, "transport"> & {
    readonly transport: MemoryTransport;
    readonly screenshot?: boolean;
    readonly children?: ReactNode;
  },
): ReactElement {
  const { screenshot = false, capture, ...rest } = props;
  return <ElicitorProvider {...rest} capture={{ screenshot, consoleErrors: false, ...capture }} />;
}

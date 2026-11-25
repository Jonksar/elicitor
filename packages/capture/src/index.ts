export type {
  CaptureContext,
  ConsoleErrorEntry,
  Region,
  RequestLogEntry,
} from "@elicitor/core";
export { captureScreenshot, collectRegionText } from "./capture.ts";
export { collectContext } from "./context.ts";
export {
  type ConsoleErrorBuffer,
  createConsoleErrorBuffer,
  createRequestLog,
  type RequestLog,
} from "./logs.ts";
export {
  type CaptureResult,
  type RegionSelectLabels,
  type RegionSelectOptions,
  startRegionSelect,
} from "./region-select.ts";

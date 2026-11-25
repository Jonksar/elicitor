export type {
  CaptureResult,
  ConsoleErrorBuffer,
  RegionSelectLabels,
  RegionSelectOptions,
  RequestLog,
} from "@elicitor/capture";

/** The parts of `@elicitor/capture` this package calls. This is the only file that loads it. */
export type CaptureModule = Pick<
  typeof import("@elicitor/capture"),
  "startRegionSelect" | "collectContext" | "createConsoleErrorBuffer"
>;

let loading: Promise<CaptureModule> | null = null;

/** Loads `@elicitor/capture` on first use; later calls share the same promise. */
export const loadCapture = (): Promise<CaptureModule> => {
  if (!loading) {
    loading = import("@elicitor/capture").then(
      (module): CaptureModule => module,
      (error: unknown) => {
        loading = null;
        throw error;
      },
    );
  }
  return loading;
};

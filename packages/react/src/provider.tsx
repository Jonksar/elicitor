import type {
  CaptureContext,
  ConsoleErrorEntry,
  CreateReportInput,
  ElicitorTransport,
  ReportDetail,
  ReportListItem,
  RequestLogEntry,
} from "@elicitor/core";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type CaptureResult,
  type ConsoleErrorBuffer,
  loadCapture,
  type RegionSelectLabels,
  type RegionSelectOptions,
  type RequestLog,
} from "./capture-api.ts";
import { ElicitorActionError } from "./errors.ts";

/** How many console errors the provider keeps. */
export const CONSOLE_ERROR_LIMIT = 30;

/** What is captured with a report. Every piece can be switched off. */
export interface ElicitorCaptureConfig {
  /** Take a screenshot of the view. Default true. */
  readonly screenshot?: boolean;
  /** Read the text inside the marked region. Default true. */
  readonly regionText?: boolean;
  /** Most region text entries to keep; passed to the region select as is. */
  readonly maxRegionText?: number;
  /** Send navigator.userAgent in the context. Default true. */
  readonly userAgent?: boolean;
  /**
   * true (default): keep the last 30 console errors and unhandled rejections from mount on. The
   * provider loads `@elicitor/capture` after mount to install the buffer, and removes it on
   * unmount. false: send none. A function: the host keeps its own buffer and returns its entries;
   * it is called when the context is captured (when the region select ends), and the provider
   * installs nothing.
   */
  readonly consoleErrors?: boolean | (() => ReadonlyArray<ConsoleErrorEntry>);
  /** Identifies the deployed build in the context. Default: decided by `@elicitor/capture`. */
  readonly bundleId?: string;
  /** The host's request log, or a function returning its entries at report time. */
  readonly requestLog?: RequestLog | (() => ReadonlyArray<RequestLogEntry>);
  /** Default region-select overlay texts; `open()` / `start()` options override them per key. */
  readonly labels?: Partial<RegionSelectLabels>;
  /** z-index of the region-select overlay. */
  readonly zIndex?: number;
}

export interface ElicitorProviderProps {
  readonly transport: ElicitorTransport;
  /** Reporter's language code, also sent as the context language. Default "en". Stored as is. */
  readonly locale?: string;
  /**
   * UI texts by key. Stored and exposed untouched; this package never reads them. A full bundle,
   * a partial one or a plain string record are all accepted.
   */
  readonly messages?: MessagesInput;
  readonly capture?: ElicitorCaptureConfig;
  /** The route sent with a report. Default: location.pathname + location.search. */
  readonly getRoute?: () => string;
  /** Opaque host data sent as CreateReportInput.metadata (for example the selected tenant). */
  readonly getMetadata?: () => Readonly<Record<string, unknown>> | undefined;
  /** Called after the transport created a report, from submit() and createReport(). */
  readonly onReportCreated?: (report: ReportListItem) => void;
  /** Called with every transport or capture error a hook stores in its state. */
  readonly onError?: (error: unknown) => void;
  readonly children?: ReactNode;
}

/** UI texts by key, as the provider's `messages` prop takes them. Undefined values are ignored. */
export type MessagesInput = Readonly<Record<string, string | undefined>>;

export type FlowStep = "idle" | "selecting" | "composing" | "submitting" | "thread";

export interface FlowState {
  readonly step: FlowStep;
  /** The selection being reported; set in "composing" and "submitting". */
  readonly capture: CaptureResult | null;
  /** The created report's id; set in "thread". */
  readonly reportId: string | null;
  /** The last capture or submit error of this flow; null when none. */
  readonly error: unknown;
}

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface ReportsState {
  /** Newest first, as the transport returned them. */
  readonly items: ReadonlyArray<ReportListItem>;
  /** "idle" until the first refresh(). Stays "ready" (items kept) while a refresh runs. */
  readonly status: LoadStatus;
  readonly error: unknown;
  /** Loads the list. Never rejects: failures land in `status` / `error`. */
  refresh(): Promise<void>;
}

/** Per-call overlay options for open() and useCapture().start(). */
export interface OpenOptions {
  readonly labels?: Partial<RegionSelectLabels>;
  readonly zIndex?: number;
}

export interface SubmitOptions {
  /** Move to "thread" with the new report (default true); false goes back to "idle". */
  readonly openThread?: boolean;
}

export interface CreateReportOptions {
  readonly sentence: string;
  readonly capture?: CaptureResult | null;
}

export interface ElicitorApi {
  readonly locale: string;
  readonly messages: MessagesInput;
  readonly transport: ElicitorTransport;
  readonly flow: FlowState;
  /** Starts a region select; resolves in "composing", or back in "idle" when cancelled/failed. */
  open(options?: OpenOptions): Promise<void>;
  /** Back to "idle"; aborts a running region select. Ignored while "submitting". */
  close(): void;
  /** Sends the sentence with the flow's capture; moves to "thread" (or "idle", see options). */
  submit(sentence: string, options?: SubmitOptions): Promise<ReportListItem>;
  /** Creates a report without the flow, capturing route, context and metadata now. */
  createReport(input: CreateReportOptions): Promise<ReportListItem>;
  readonly reports: ReportsState;
}

export interface CaptureApi {
  /** Runs the region select with the provider's switches; null when cancelled. */
  start(options?: CaptureStartOptions): Promise<CaptureResult | null>;
  /** True while a region select runs. */
  readonly capturing: boolean;
}

/** useCapture().start() options. screenshot / regionText can only switch off what the provider allows. */
export type CaptureStartOptions = Pick<
  RegionSelectOptions,
  "labels" | "zIndex" | "signal" | "screenshot" | "regionText" | "maxRegionText"
>;

interface Snapshot {
  readonly route: string;
  readonly context: CaptureContext;
  readonly metadata: Readonly<Record<string, unknown>> | undefined;
}

interface Internal {
  readonly api: ElicitorApi;
  readonly capture: CaptureApi;
  /** Updates a listed report from a newer detail; no request. */
  readonly patchListItem: (detail: ReportDetail) => void;
  readonly reportError: (error: unknown) => void;
}

const ElicitorContext = createContext<Internal | null>(null);

const IDLE_FLOW: FlowState = { step: "idle", capture: null, reportId: null, error: null };

const listItemOf = (detail: ReportDetail): ReportListItem => ({
  id: detail.id,
  ...(detail.number !== undefined ? { number: detail.number } : {}),
  status: detail.status,
  title: detail.title,
  sentence: detail.sentence,
  createdAt: detail.createdAt,
  statusChangedAt: detail.statusChangedAt,
  unread: detail.unread,
});

const defaultRoute = (): string => location.pathname + location.search;

export function ElicitorProvider(props: ElicitorProviderProps): ReactElement {
  const { transport, locale = "en", messages, children } = props;
  const latest = useRef(props);
  latest.current = props;
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const mounted = useRef(false);
  const buffer = useRef<ConsoleErrorBuffer | null>(null);
  // Only the default buffer needs installing; a host function brings its own.
  const consoleErrors = (props.capture?.consoleErrors ?? true) === true;

  const [flow, setFlowState] = useState<FlowState>(IDLE_FLOW);
  const flowRef = useRef<FlowState>(IDLE_FLOW);
  const flowGen = useRef(0);
  const snapshot = useRef<Snapshot | null>(null);
  const selection = useRef<AbortController | null>(null);
  const setFlow = useCallback((next: FlowState) => {
    flowRef.current = next;
    setFlowState(next);
  }, []);

  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);

  const [list, setList] = useState<Omit<ReportsState, "refresh">>({
    items: [],
    status: "idle",
    error: null,
  });
  const listRef = useRef(list);
  const listGen = useRef(0);
  const updateList = useCallback((next: Omit<ReportsState, "refresh">) => {
    listRef.current = next;
    setList(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selection.current?.abort();
    };
  }, []);

  const reportError = useCallback((error: unknown) => {
    latest.current.onError?.(error);
  }, []);

  useEffect(() => {
    if (!consoleErrors) return;
    let active = true;
    let uninstall: (() => void) | null = null;
    loadCapture().then(
      (capture) => {
        if (!active) return;
        const created = capture.createConsoleErrorBuffer(CONSOLE_ERROR_LIMIT);
        uninstall = created.install();
        buffer.current = created;
      },
      (error: unknown) => {
        if (active) reportError(error);
      },
    );
    return () => {
      active = false;
      uninstall?.();
      buffer.current = null;
    };
  }, [consoleErrors, reportError]);

  const startCapture = useCallback(
    async (options: CaptureStartOptions = {}): Promise<CaptureResult | null> => {
      if (capturingRef.current) throw new ElicitorActionError("busy", "A region select is running");
      const config = latest.current.capture ?? {};
      capturingRef.current = true;
      setCapturing(true);
      try {
        const capture = await loadCapture();
        const labels = { ...config.labels, ...options.labels };
        const zIndex = options.zIndex ?? config.zIndex;
        const maxRegionText = options.maxRegionText ?? config.maxRegionText;
        return await capture.startRegionSelect({
          screenshot: config.screenshot !== false && options.screenshot !== false,
          regionText: config.regionText !== false && options.regionText !== false,
          ...(Object.keys(labels).length > 0 ? { labels } : {}),
          ...(zIndex !== undefined ? { zIndex } : {}),
          ...(maxRegionText !== undefined ? { maxRegionText } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } finally {
        capturingRef.current = false;
        if (mounted.current) setCapturing(false);
      }
    },
    [],
  );

  const takeSnapshot = useCallback(async (): Promise<Snapshot> => {
    const { capture: config = {}, getRoute, getMetadata } = latest.current;
    const capture = await loadCapture();
    const requestLog =
      typeof config.requestLog === "function" ? config.requestLog() : config.requestLog?.entries();
    const consoleErrors =
      typeof config.consoleErrors === "function"
        ? config.consoleErrors()
        : config.consoleErrors === false
          ? []
          : (buffer.current?.entries() ?? []);
    const context = capture.collectContext({
      language: localeRef.current,
      userAgent: config.userAgent !== false,
      consoleErrors,
      ...(config.bundleId !== undefined ? { bundleId: config.bundleId } : {}),
      ...(requestLog !== undefined ? { requestLog } : {}),
    });
    return { route: (getRoute ?? defaultRoute)(), context, metadata: getMetadata?.() };
  }, []);

  const send = useCallback(
    async (
      sentence: string,
      capture: CaptureResult | null,
      taken: Snapshot,
    ): Promise<ReportListItem> => {
      const input: CreateReportInput = {
        sentence,
        route: taken.route,
        ...(capture?.region ? { region: capture.region } : {}),
        regionText: capture?.regionText ?? [],
        context: taken.context,
        screenshotPng: capture?.screenshotPng ?? "",
        ...(taken.metadata !== undefined ? { metadata: taken.metadata } : {}),
      };
      const item = await latest.current.transport.create(input);
      const current = listRef.current;
      if (
        mounted.current &&
        current.status !== "idle" &&
        !current.items.some((i) => i.id === item.id)
      )
        updateList({ ...current, items: [item, ...current.items] });
      latest.current.onReportCreated?.(item);
      return item;
    },
    [updateList],
  );

  const open = useCallback(
    async (options: OpenOptions = {}): Promise<void> => {
      const step = flowRef.current.step;
      if (step === "selecting") return;
      if (step === "submitting") throw new ElicitorActionError("busy", "A report is being sent");
      if (capturingRef.current) throw new ElicitorActionError("busy", "A region select is running");
      const gen = ++flowGen.current;
      selection.current?.abort();
      const controller = new AbortController();
      selection.current = controller;
      snapshot.current = null;
      setFlow({ step: "selecting", capture: null, reportId: null, error: null });
      const current = () => mounted.current && flowGen.current === gen;
      try {
        const result = await startCapture({ ...options, signal: controller.signal });
        if (!current()) return;
        if (!result) {
          setFlow(IDLE_FLOW);
          return;
        }
        const taken = await takeSnapshot();
        if (!current()) return;
        snapshot.current = taken;
        setFlow({ step: "composing", capture: result, reportId: null, error: null });
      } catch (error) {
        if (!current()) return;
        setFlow({ ...IDLE_FLOW, error });
        reportError(error);
      } finally {
        if (selection.current === controller) selection.current = null;
      }
    },
    [setFlow, startCapture, takeSnapshot, reportError],
  );

  const close = useCallback(() => {
    if (flowRef.current.step === "submitting") return;
    flowGen.current++;
    selection.current?.abort();
    selection.current = null;
    snapshot.current = null;
    setFlow(IDLE_FLOW);
  }, [setFlow]);

  const submit = useCallback(
    async (sentence: string, options: SubmitOptions = {}): Promise<ReportListItem> => {
      const state = flowRef.current;
      if (state.step === "submitting")
        throw new ElicitorActionError("busy", "A report is being sent");
      if (state.step !== "composing" || !snapshot.current)
        throw new ElicitorActionError("invalid_step", "submit() needs the composing step");
      const text = sentence.trim();
      if (!text) throw new ElicitorActionError("empty", "The sentence is empty");
      const gen = ++flowGen.current;
      const taken = snapshot.current;
      setFlow({ ...state, step: "submitting", error: null });
      try {
        const item = await send(text, state.capture, taken);
        if (mounted.current && flowGen.current === gen) {
          snapshot.current = null;
          setFlow(
            options.openThread === false
              ? IDLE_FLOW
              : { step: "thread", capture: null, reportId: item.id, error: null },
          );
        }
        return item;
      } catch (error) {
        if (mounted.current && flowGen.current === gen) {
          setFlow({ ...state, step: "composing", error });
          reportError(error);
        }
        throw error;
      }
    },
    [setFlow, send, reportError],
  );

  const createReport = useCallback(
    async (input: CreateReportOptions): Promise<ReportListItem> => {
      const text = input.sentence.trim();
      if (!text) throw new ElicitorActionError("empty", "The sentence is empty");
      try {
        return await send(text, input.capture ?? null, await takeSnapshot());
      } catch (error) {
        reportError(error);
        throw error;
      }
    },
    [send, takeSnapshot, reportError],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const gen = ++listGen.current;
    const current = () => mounted.current && listGen.current === gen;
    const before = listRef.current;
    if (before.status !== "ready") updateList({ ...before, status: "loading" });
    try {
      const items = await latest.current.transport.list();
      if (current()) updateList({ items, status: "ready", error: null });
    } catch (error) {
      if (!current()) return;
      updateList({ ...listRef.current, status: "error", error });
      reportError(error);
    }
  }, [updateList, reportError]);

  const patchListItem = useCallback(
    (detail: ReportDetail) => {
      const current = listRef.current;
      if (!mounted.current || !current.items.some((item) => item.id === detail.id)) return;
      const next = listItemOf(detail);
      updateList({
        ...current,
        items: current.items.map((item) => (item.id === detail.id ? next : item)),
      });
    },
    [updateList],
  );

  const resolvedMessages = useMemo(() => messages ?? {}, [messages]);
  const reports = useMemo<ReportsState>(() => ({ ...list, refresh }), [list, refresh]);
  const api = useMemo<ElicitorApi>(
    () => ({
      locale,
      messages: resolvedMessages,
      transport,
      flow,
      open,
      close,
      submit,
      createReport,
      reports,
    }),
    [locale, resolvedMessages, transport, flow, open, close, submit, createReport, reports],
  );
  const captureApi = useMemo<CaptureApi>(
    () => ({ start: startCapture, capturing }),
    [startCapture, capturing],
  );
  const value = useMemo<Internal>(
    () => ({ api, capture: captureApi, patchListItem, reportError }),
    [api, captureApi, patchListItem, reportError],
  );
  return <ElicitorContext.Provider value={value}>{children}</ElicitorContext.Provider>;
}

/** @internal Shared by the hooks of this package. */
export const useElicitorInternal = (hook: string): Internal => {
  const value = useContext(ElicitorContext);
  if (!value) throw new Error(`${hook}() must be used inside <ElicitorProvider>`);
  return value;
};

/** The imperative API for custom UIs. Throws outside <ElicitorProvider>. */
export const useElicitor = (): ElicitorApi => useElicitorInternal("useElicitor").api;

/** Region selection with the provider's capture switches. Throws outside <ElicitorProvider>. */
export const useCapture = (): CaptureApi => useElicitorInternal("useCapture").capture;

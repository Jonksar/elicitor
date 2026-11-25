import type {
  CaptureContext,
  ConsoleErrorEntry,
  CreateReportInput,
  ElicitorTransport,
  ReportDetail,
  RequestLogEntry,
} from "@elicitor/core";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import type { CaptureResult, RegionSelectOptions } from "./capture-api.ts";
import { isElicitorActionError, isElicitorTransportError } from "./errors.ts";
import {
  ElicitorProvider,
  type ElicitorProviderProps,
  useCapture,
  useElicitor,
} from "./provider.tsx";
import { createMemoryTransport, type MemoryTransport } from "./testing.ts";
import { useReport } from "./use-report.ts";

// ---------------------------------------------------------------------------------------------
// @elicitor/capture is replaced by fakes: the region select is driven by the test.
// ---------------------------------------------------------------------------------------------

interface CollectOptions {
  bundleId?: string;
  language?: string;
  requestLog?: ReadonlyArray<RequestLogEntry>;
  consoleErrors?: ReadonlyArray<ConsoleErrorEntry>;
  userAgent?: boolean;
}

const fakes = vi.hoisted(() => {
  const uninstall = vi.fn<() => void>();
  const install = vi.fn<() => () => void>();
  const entries = vi.fn<() => ConsoleErrorEntry[]>();
  return {
    uninstall,
    install,
    entries,
    startRegionSelect: vi.fn<(options?: RegionSelectOptions) => Promise<CaptureResult | null>>(),
    collectContext: vi.fn<(options?: CollectOptions) => CaptureContext>(),
    createConsoleErrorBuffer:
      vi.fn<
        (limit?: number) => { install: typeof install; entries: typeof entries; clear: () => void }
      >(),
  };
});

vi.mock("@elicitor/capture", () => ({
  startRegionSelect: fakes.startRegionSelect,
  collectContext: fakes.collectContext,
  createConsoleErrorBuffer: fakes.createConsoleErrorBuffer,
}));

const SELECTION: CaptureResult = {
  region: { x: 10, y: 20, width: 100, height: 40, viewportWidth: 800, viewportHeight: 600 },
  screenshotPng: "iVBORw0KGgo=",
  regionText: ["Total", "10.00"],
};
const CONSOLE_ERROR: ConsoleErrorEntry = { at: "2026-01-01T00:00:00.000Z", message: "Boom" };

beforeEach(() => {
  fakes.install.mockImplementation(() => fakes.uninstall);
  fakes.entries.mockImplementation(() => [CONSOLE_ERROR]);
  fakes.createConsoleErrorBuffer.mockImplementation(() => ({
    install: fakes.install,
    entries: fakes.entries,
    clear: () => {},
  }));
  fakes.startRegionSelect.mockImplementation(async () => SELECTION);
  fakes.collectContext.mockImplementation((options = {}) => ({
    language: options.language ?? "xx",
    viewport: { width: 800, height: 600 },
    userAgent: options.userAgent === false ? "" : "test-agent",
    bundleId: options.bundleId ?? "dev",
    requestLog: options.requestLog ?? [],
    consoleErrors: options.consoleErrors ?? [],
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

/** Spies on every transport method while keeping the memory transport's behaviour. */
const spied = (transport: MemoryTransport) => ({
  create: vi.spyOn(transport, "create"),
  list: vi.spyOn(transport, "list"),
  get: vi.spyOn(transport, "get"),
  reply: vi.spyOn(transport, "reply"),
  confirm: vi.spyOn(transport, "confirm"),
  withdraw: vi.spyOn(transport, "withdraw"),
});

type ProviderOptions = Omit<ElicitorProviderProps, "transport" | "children">;

const wrapperFor =
  (transport: ElicitorTransport, options: ProviderOptions = {}, strict = false) =>
  ({ children }: { children: ReactNode }) => {
    const tree = (
      <ElicitorProvider transport={transport} getRoute={() => "/orders?page=2"} {...options}>
        {children}
      </ElicitorProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };

/** useElicitor and useReport on the flow's report, in one component. */
const renderWidget = (
  transport: ElicitorTransport,
  options: ProviderOptions = {},
  strict = false,
) =>
  renderHook(
    () => {
      const elicitor = useElicitor();
      const report = useReport(elicitor.flow.reportId);
      return { elicitor, report };
    },
    { wrapper: wrapperFor(transport, options, strict) },
  );

const renderReport = (transport: ElicitorTransport, id: string, options: ProviderOptions = {}) =>
  renderHook((reportId?: string | null) => useReport(reportId === undefined ? id : reportId), {
    wrapper: wrapperFor(transport, options),
  });

const contextOf = (language = "en"): CaptureContext => ({
  language,
  viewport: { width: 800, height: 600 },
  userAgent: "test-agent",
  bundleId: "dev",
  requestLog: [],
  consoleErrors: [],
});

/** Creates a report straight through the transport, past the widget. */
const seed = async (
  transport: ElicitorTransport,
  sentence = "The total is wrong",
): Promise<string> =>
  (
    await transport.create({
      sentence,
      route: "/orders",
      regionText: [],
      context: contextOf(),
      screenshotPng: "",
    })
  ).id;

/** A seeded report advanced to a pending summary (seq 4). */
const seedWithSummary = async (transport: ElicitorTransport): Promise<string> => {
  const id = await seed(transport);
  await transport.reply(id, "It should be 12");
  return id;
};

const errorOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );

// ---------------------------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------------------------

describe("the report flow", () => {
  it("goes open -> select -> compose -> submit -> question -> reply -> summary -> confirm", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const onReportCreated = vi.fn();
    const { result } = await renderWidget(transport, { locale: "en", onReportCreated }, true);

    expect(result.current.elicitor.flow).toEqual({
      step: "idle",
      capture: null,
      reportId: null,
      error: null,
    });
    const selecting = deferred<CaptureResult | null>();
    fakes.startRegionSelect.mockImplementationOnce(() => selecting.promise);
    const opened = result.current.elicitor.open();
    await expect.poll(() => result.current.elicitor.flow.step).toBe("selecting");
    selecting.resolve(SELECTION);
    await opened;
    await expect.poll(() => result.current.elicitor.flow.step).toBe("composing");
    expect(result.current.elicitor.flow.capture).toEqual(SELECTION);
    expect(fakes.startRegionSelect).toHaveBeenCalledTimes(1);

    const item = await result.current.elicitor.submit("  The total is wrong  ");
    await expect.poll(() => result.current.elicitor.flow.step).toBe("thread");
    expect(result.current.elicitor.flow.reportId).toBe(item.id);
    expect(result.current.elicitor.flow.capture).toBeNull();
    expect(onReportCreated).toHaveBeenCalledWith(item);

    const input = calls.create.mock.calls[0]?.[0] as CreateReportInput;
    expect(input).toEqual({
      sentence: "The total is wrong",
      route: "/orders?page=2",
      region: SELECTION.region,
      regionText: SELECTION.regionText,
      screenshotPng: SELECTION.screenshotPng,
      context: {
        language: "en",
        viewport: { width: 800, height: 600 },
        userAgent: "test-agent",
        bundleId: "dev",
        requestLog: [],
        consoleErrors: [CONSOLE_ERROR],
      },
    });
    expect("metadata" in input).toBe(false);

    await expect.poll(() => result.current.report.status).toBe("ready");
    expect(result.current.report.report?.messages.map((m) => [m.seq, m.author, m.body])).toEqual([
      [1, "reporter", "The total is wrong"],
      [2, "agent", "What should be shown there instead?"],
    ]);
    expect(result.current.report.canReply).toBe(true);
    expect(result.current.report.canConfirm).toBe(false);

    const getsBeforeReply = calls.get.mock.calls.length;
    await result.current.report.reply("It should be 12");
    await expect.poll(() => result.current.report.report?.pendingSummarySeq).toBe(4);
    expect(result.current.report.pending).toBeNull();
    expect(calls.get.mock.calls.length).toBe(getsBeforeReply);
    expect(result.current.report.report?.pendingSummarySeq).toBe(4);
    expect(result.current.report.report?.pendingSummary?.expected).toBe("It should be 12");
    expect(result.current.report.canConfirm).toBe(true);

    await result.current.report.confirm();
    expect(calls.confirm).toHaveBeenCalledWith(item.id, 4);
    await expect.poll(() => result.current.report.report?.status).toBe("submitted");
    expect(result.current.report.report?.summary?.expected).toBe("It should be 12");
    expect(result.current.report.canConfirm).toBe(false);
    expect(result.current.report.canReply).toBe(false);
    expect(calls.get.mock.calls.length).toBe(getsBeforeReply);
  });

  it("goes back to idle when the region select is cancelled", async () => {
    fakes.startRegionSelect.mockImplementationOnce(async () => null);
    const { result } = await renderWidget(createMemoryTransport());
    await result.current.elicitor.open();
    await expect.poll(() => result.current.elicitor.flow.step).toBe("idle");
    expect(result.current.elicitor.flow.error).toBeNull();
  });

  it("stores a capture failure in flow.error and reports it", async () => {
    const failure = new Error("canvas tainted");
    fakes.startRegionSelect.mockImplementationOnce(async () => {
      throw failure;
    });
    const onError = vi.fn();
    const { result } = await renderWidget(createMemoryTransport(), { onError });
    await result.current.elicitor.open();
    await expect.poll(() => result.current.elicitor.flow.error).toBe(failure);
    expect(result.current.elicitor.flow.step).toBe("idle");
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("close() aborts a running region select and ignores its late result", async () => {
    const selecting = deferred<CaptureResult | null>();
    fakes.startRegionSelect.mockImplementationOnce(() => selecting.promise);
    const { result } = await renderWidget(createMemoryTransport());
    const opened = result.current.elicitor.open({ labels: { hint: "Mark it" }, zIndex: 9 });
    await expect.poll(() => result.current.elicitor.flow.step).toBe("selecting");
    const options = fakes.startRegionSelect.mock.calls[0]?.[0];
    expect(options?.labels).toEqual({ hint: "Mark it" });
    expect(options?.zIndex).toBe(9);
    result.current.elicitor.close();
    expect(options?.signal?.aborted).toBe(true);
    selecting.resolve(SELECTION);
    await opened;
    await expect.poll(() => result.current.elicitor.flow.step).toBe("idle");
    expect(result.current.elicitor.flow.capture).toBeNull();
  });

  it("keeps the capture and returns to composing when the submit fails", async () => {
    const transport = createMemoryTransport();
    const failure = new Error("offline");
    vi.spyOn(transport, "create").mockRejectedValueOnce(failure);
    const onError = vi.fn();
    const { result } = await renderWidget(transport, { onError });
    await result.current.elicitor.open();
    await expect.poll(() => result.current.elicitor.flow.step).toBe("composing");
    expect(await errorOf(result.current.elicitor.submit("Wrong"))).toBe(failure);
    await expect.poll(() => result.current.elicitor.flow.error).toBe(failure);
    expect(result.current.elicitor.flow.step).toBe("composing");
    expect(result.current.elicitor.flow.capture).toEqual(SELECTION);
    expect(onError).toHaveBeenCalledWith(failure);

    await result.current.elicitor.submit("Wrong");
    await expect.poll(() => result.current.elicitor.flow.step).toBe("thread");
    expect(result.current.elicitor.flow.error).toBeNull();
  });

  it("refuses a second submit, an empty sentence and close() while submitting", async () => {
    const transport = createMemoryTransport();
    const created = deferred<void>();
    const original = transport.create.bind(transport);
    const create = vi.spyOn(transport, "create").mockImplementation(async (input) => {
      await created.promise;
      return original(input);
    });
    const { result } = await renderWidget(transport);
    expect(isElicitorActionError(await errorOf(result.current.elicitor.submit("x")))).toBe(true);
    await result.current.elicitor.open();
    await expect.poll(() => result.current.elicitor.flow.step).toBe("composing");
    expect(await errorOf(result.current.elicitor.submit("   "))).toMatchObject({ code: "empty" });

    const first = result.current.elicitor.submit("Wrong");
    await expect.poll(() => result.current.elicitor.flow.step).toBe("submitting");
    expect(await errorOf(result.current.elicitor.submit("Wrong"))).toMatchObject({ code: "busy" });
    result.current.elicitor.close();
    expect(result.current.elicitor.flow.step).toBe("submitting");
    created.resolve();
    await first;
    await expect.poll(() => result.current.elicitor.flow.step).toBe("thread");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("createReport() sends a report without the flow", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const { result } = await renderWidget(transport, { locale: "fi" });
    const item = await result.current.elicitor.createReport({ sentence: "Wrong" });
    expect(result.current.elicitor.flow.step).toBe("idle");
    expect(calls.create).toHaveBeenCalledWith({
      sentence: "Wrong",
      route: "/orders?page=2",
      regionText: [],
      screenshotPng: "",
      context: expect.objectContaining({ language: "fi" }),
    });
    expect(transport.store.toListItem(item.id)?.sentence).toBe("Wrong");
  });

  it("defaults the route to location.pathname + location.search", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const { result } = await renderHook(() => useElicitor(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ElicitorProvider transport={transport}>{children}</ElicitorProvider>
      ),
    });
    await result.current.createReport({ sentence: "Wrong" });
    expect(calls.create.mock.calls[0]?.[0].route).toBe(location.pathname + location.search);
    expect(result.current.locale).toBe("en");
    expect(result.current.messages).toEqual({});
  });

  it("exposes locale, messages and transport untouched", async () => {
    const transport = createMemoryTransport();
    const messages = { "elicitor.send": "Send it" };
    const { result } = await renderWidget(transport, { locale: "de", messages });
    expect(result.current.elicitor.locale).toBe("de");
    expect(result.current.elicitor.messages).toBe(messages);
    expect(result.current.elicitor.transport).toBe(transport);
  });

  it("throws a clear error outside the provider", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(renderHook(() => useElicitor())).rejects.toThrow(
        "useElicitor() must be used inside <ElicitorProvider>",
      );
      await expect(renderHook(() => useReport(null))).rejects.toThrow(
        "useReport() must be used inside <ElicitorProvider>",
      );
      await expect(renderHook(() => useCapture())).rejects.toThrow(
        "useCapture() must be used inside <ElicitorProvider>",
      );
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Host metadata and capture switches
// ---------------------------------------------------------------------------------------------

describe("host data and capture switches", () => {
  it("sends getMetadata() as CreateReportInput.metadata unchanged (the host's tenant selection)", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const metadata = { tenantId: "t-42", companyId: null, nested: { role: "viewer" } };
    let selected: Readonly<Record<string, unknown>> = metadata;
    const { result } = await renderWidget(transport, { getMetadata: () => selected });
    await result.current.elicitor.open();
    await expect.poll(() => result.current.elicitor.flow.step).toBe("composing");
    const item = await result.current.elicitor.submit("Wrong");
    expect(calls.create.mock.calls[0]?.[0].metadata).toBe(metadata);
    expect(transport.store.metadataOf(item.id)).toEqual(metadata);

    selected = { tenantId: "t-7" };
    await result.current.elicitor.createReport({ sentence: "Also wrong" });
    expect(calls.create.mock.calls[1]?.[0].metadata).toEqual({ tenantId: "t-7" });
  });

  it("takes route and metadata when the region is chosen, not when the sentence is sent", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    let route = "/first";
    let tenant = "t-1";
    const { result } = await renderWidget(transport, {
      getRoute: () => route,
      getMetadata: () => ({ tenant }),
    });
    await result.current.elicitor.open();
    await expect.poll(() => result.current.elicitor.flow.step).toBe("composing");
    route = "/second";
    tenant = "t-2";
    await result.current.elicitor.submit("Wrong");
    expect(calls.create.mock.calls[0]?.[0]).toMatchObject({
      route: "/first",
      metadata: { tenant: "t-1" },
    });
  });

  it("passes screenshot/regionText switches, labels and limits to the region select", async () => {
    const { result } = await renderHook(() => useCapture(), {
      wrapper: wrapperFor(createMemoryTransport(), {
        capture: {
          screenshot: false,
          regionText: true,
          maxRegionText: 5,
          zIndex: 100,
          labels: { hint: "Mark", cancel: "Stop" },
        },
      }),
    });
    expect(result.current.capturing).toBe(false);
    const selecting = deferred<CaptureResult | null>();
    fakes.startRegionSelect.mockImplementationOnce(() => selecting.promise);
    const started = result.current.start({ labels: { cancel: "Abort" }, screenshot: true });
    await expect.poll(() => result.current.capturing).toBe(true);
    expect(await errorOf(result.current.start())).toMatchObject({ code: "busy" });
    selecting.resolve(null);
    expect(await started).toBeNull();
    await expect.poll(() => result.current.capturing).toBe(false);
    expect(fakes.startRegionSelect).toHaveBeenCalledTimes(1);
    expect(fakes.startRegionSelect).toHaveBeenCalledWith({
      screenshot: false,
      regionText: true,
      maxRegionText: 5,
      zIndex: 100,
      labels: { hint: "Mark", cancel: "Abort" },
    });

    await result.current.start({ regionText: false });
    expect(fakes.startRegionSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ screenshot: false, regionText: false }),
    );
  });

  it("open() refuses while useCapture().start() runs, without touching the flow", async () => {
    const onError = vi.fn();
    const { result } = await renderHook(
      () => ({ elicitor: useElicitor(), capture: useCapture() }),
      { wrapper: wrapperFor(createMemoryTransport(), { onError }) },
    );
    const selecting = deferred<CaptureResult | null>();
    fakes.startRegionSelect.mockImplementationOnce(() => selecting.promise);
    const started = result.current.capture.start();
    await expect.poll(() => result.current.capture.capturing).toBe(true);
    expect(await errorOf(result.current.elicitor.open())).toMatchObject({ code: "busy" });
    expect(result.current.elicitor.flow).toMatchObject({ step: "idle", error: null });
    expect(onError).not.toHaveBeenCalled();
    selecting.resolve(null);
    await started;
  });

  it("asks for screenshot and region text by default", async () => {
    const { result } = await renderHook(() => useCapture(), {
      wrapper: wrapperFor(createMemoryTransport()),
    });
    expect(await result.current.start()).toEqual(SELECTION);
    expect(fakes.startRegionSelect).toHaveBeenCalledWith({ screenshot: true, regionText: true });
  });

  it("with consoleErrors off installs no buffer and sends no console errors", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const { result } = await renderWidget(transport, {
      capture: { consoleErrors: false, userAgent: false, bundleId: "build-9" },
    });
    await result.current.elicitor.createReport({ sentence: "Wrong" });
    expect(fakes.createConsoleErrorBuffer).not.toHaveBeenCalled();
    expect(fakes.collectContext).toHaveBeenCalledWith({
      language: "en",
      userAgent: false,
      consoleErrors: [],
      bundleId: "build-9",
    });
    expect(calls.create.mock.calls[0]?.[0].context).toMatchObject({
      userAgent: "",
      bundleId: "build-9",
      consoleErrors: [],
    });
  });

  it("installs a 30-entry console buffer on mount and uninstalls it on unmount", async () => {
    const { unmount } = await renderWidget(createMemoryTransport());
    await expect.poll(() => fakes.install.mock.calls.length).toBe(1);
    expect(fakes.createConsoleErrorBuffer).toHaveBeenCalledWith(30);
    expect(fakes.uninstall).not.toHaveBeenCalled();
    await unmount();
    expect(fakes.uninstall).toHaveBeenCalledTimes(1);
  });

  it("installs the buffer once under StrictMode and removes it on unmount", async () => {
    const { unmount } = await renderWidget(createMemoryTransport(), {}, true);
    await expect.poll(() => fakes.install.mock.calls.length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakes.install).toHaveBeenCalledTimes(1);
    await unmount();
    expect(fakes.uninstall).toHaveBeenCalledTimes(1);
  });

  it("reads the request log from a function or from a RequestLog", async () => {
    const entry: RequestLogEntry = {
      tag: "orders.list",
      startedAt: "2026-01-01T00:00:00.000Z",
      ms: 12,
      outcome: "ok",
    };
    for (const requestLog of [
      () => [entry],
      { push: () => {}, entries: () => [entry], clear: () => {} },
    ]) {
      const transport = createMemoryTransport();
      const calls = spied(transport);
      const { result, unmount } = await renderWidget(transport, { capture: { requestLog } });
      await result.current.elicitor.createReport({ sentence: "Wrong" });
      expect(calls.create.mock.calls[0]?.[0].context.requestLog).toEqual([entry]);
      await unmount();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// useReport
// ---------------------------------------------------------------------------------------------

describe("useReport", () => {
  it("uses the latest pending seq after a correction", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const id = await seedWithSummary(transport);
    const { result } = await renderReport(transport, id);
    await expect.poll(() => result.current.report?.pendingSummarySeq).toBe(4);

    await result.current.reply("No, it should be 14");
    await expect.poll(() => result.current.report?.pendingSummarySeq).toBe(6);
    expect(result.current.report?.pendingSummary?.expected).toBe("No, it should be 14");

    await result.current.confirm();
    expect(calls.confirm).toHaveBeenCalledWith(id, 6);
    await expect.poll(() => result.current.report?.status).toBe("submitted");
    expect(result.current.report?.summary?.expected).toBe("No, it should be 14");
  });

  it("surfaces a stale confirm and recovers after refresh", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const onError = vi.fn();
    const id = await seedWithSummary(transport);
    const { result } = await renderReport(transport, id, { onError });
    await expect.poll(() => result.current.report?.pendingSummarySeq).toBe(4);

    // The reporter corrected the summary elsewhere (another tab): the server is at seq 6.
    await transport.reply(id, "Actually 14");
    const error = await errorOf(result.current.confirm());
    expect(isElicitorTransportError(error)).toBe(true);
    expect(error).toMatchObject({ status: 409, code: "stale" });
    await expect.poll(() => result.current.failed).toBe("confirm");
    expect(result.current.error).toBe(error);
    expect(result.current.status).toBe("ready");
    expect(result.current.pending).toBeNull();
    expect(result.current.report?.pendingSummarySeq).toBe(4);
    expect(onError).toHaveBeenCalledWith(error);

    await result.current.refresh();
    await expect.poll(() => result.current.report?.pendingSummarySeq).toBe(6);
    expect(result.current.error).toBeNull();
    expect(result.current.failed).toBeNull();
    await result.current.confirm();
    expect(calls.confirm).toHaveBeenLastCalledWith(id, 6);
    await expect.poll(() => result.current.report?.status).toBe("submitted");
  });

  it("gives a non-owner no actions and never calls the transport for them", async () => {
    const transport = createMemoryTransport();
    const id = await seedWithSummary(transport);
    transport.actAs(false);
    const calls = spied(transport);
    const { result } = await renderReport(transport, id);
    await expect.poll(() => result.current.status).toBe("ready");
    expect(result.current.report?.pendingSummarySeq).toBe(4);
    expect(result.current.canReply).toBe(false);
    expect(result.current.canConfirm).toBe(false);
    expect(result.current.canWithdraw).toBe(false);

    for (const action of [
      () => result.current.reply("Mine now"),
      () => result.current.confirm(),
      () => result.current.withdraw(),
    ]) {
      const error = await errorOf(action());
      expect(isElicitorActionError(error)).toBe(true);
      expect(error).toMatchObject({ code: "not_allowed" });
    }
    expect(calls.reply).not.toHaveBeenCalled();
    expect(calls.confirm).not.toHaveBeenCalled();
    expect(calls.withdraw).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("the memory transport refuses a non-owner's actions itself", async () => {
    const transport = createMemoryTransport({ owner: false });
    const id = await seed(transport);
    await expect(transport.reply(id, "x")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    await expect(transport.withdraw(id)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(transport.get("missing")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("refuses confirm while canConfirm is false and an empty reply, without a request", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const id = await seed(transport);
    const { result } = await renderReport(transport, id);
    await expect.poll(() => result.current.status).toBe("ready");
    expect(await errorOf(result.current.confirm())).toMatchObject({ code: "not_allowed" });
    expect(await errorOf(result.current.reply("   "))).toMatchObject({ code: "empty" });
    expect(calls.confirm).not.toHaveBeenCalled();
    expect(calls.reply).not.toHaveBeenCalled();
  });

  it("refuses confirm when canConfirm is true but pendingSummarySeq is null", async () => {
    const transport = createMemoryTransport();
    const id = await seed(transport);
    const original = transport.get.bind(transport);
    vi.spyOn(transport, "get").mockImplementation(async (key) => ({
      ...(await original(key)),
      canConfirm: true,
    }));
    const confirm = vi.spyOn(transport, "confirm");
    const { result } = await renderReport(transport, id);
    await expect.poll(() => result.current.status).toBe("ready");
    expect(await errorOf(result.current.confirm())).toMatchObject({ code: "no_pending_summary" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("withdraws and reloads the report", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const id = await seed(transport);
    const { result } = await renderReport(transport, id);
    await expect.poll(() => result.current.canWithdraw).toBe(true);
    await result.current.withdraw();
    await expect.poll(() => result.current.report?.status).toBe("withdrawn");
    expect(calls.withdraw).toHaveBeenCalledWith(id);
    expect(result.current.pending).toBeNull();
    expect(result.current.canWithdraw).toBe(false);
    expect(result.current.canReply).toBe(false);
  });

  it("is idle for a null id and loads when an id arrives", async () => {
    const transport = createMemoryTransport();
    const get = vi.spyOn(transport, "get");
    const id = await seed(transport);
    const { result, rerender } = await renderReport(transport, id, {});
    await rerender(null);
    await expect.poll(() => result.current.status).toBe("idle");
    expect(result.current.report).toBeNull();
    get.mockClear();
    await rerender(id);
    await expect.poll(() => result.current.status).toBe("ready");
    expect(get).toHaveBeenCalledWith(id);
  });

  it("keeps the report and reports status error when a refresh fails", async () => {
    const transport = createMemoryTransport();
    const id = await seed(transport);
    const { result } = await renderReport(transport, id);
    await expect.poll(() => result.current.status).toBe("ready");
    const failure = new Error("offline");
    vi.spyOn(transport, "get").mockRejectedValueOnce(failure);
    await result.current.refresh();
    await expect.poll(() => result.current.status).toBe("error");
    expect(result.current.error).toBe(failure);
    expect(result.current.failed).toBe("load");
    expect(result.current.report?.id).toBe(id);
    await result.current.refresh();
    await expect.poll(() => result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();
  });

  it("reports a missing report as a load error with the transport's code", async () => {
    const { result } = await renderReport(createMemoryTransport(), "missing");
    await expect.poll(() => result.current.status).toBe("error");
    expect(result.current.error).toMatchObject({ status: 404, code: "not_found" });
    expect(result.current.report).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Out-of-order responses (ported from the original widget's tests)
// ---------------------------------------------------------------------------------------------

describe("out-of-order responses", () => {
  it.each(["reply", "confirm"] as const)(
    "keeps the withdrawn report after a delayed %s completes",
    async (operation) => {
      const transport = createMemoryTransport();
      const id = operation === "reply" ? await seed(transport) : await seedWithSummary(transport);
      const completion = deferred<ReportDetail>();
      const reply = vi.spyOn(transport, "reply").mockReturnValueOnce(completion.promise);
      const confirm = vi.spyOn(transport, "confirm").mockReturnValueOnce(completion.promise);
      const { result } = await renderReport(transport, id);
      await expect.poll(() => result.current.status).toBe("ready");
      const before = result.current.report!;

      const late = operation === "reply" ? result.current.reply("Two") : result.current.confirm();
      await expect.poll(() => result.current.pending).toBe(operation);
      if (operation === "confirm") expect(confirm).toHaveBeenCalledWith(id, 4);
      else expect(reply).toHaveBeenCalledWith(id, "Two");
      // Reply and confirm are blocked while one is in flight; withdraw is not.
      expect(await errorOf(result.current.reply("Three"))).toMatchObject({ code: "busy" });

      await result.current.withdraw();
      await expect.poll(() => result.current.report?.status).toBe("withdrawn");

      completion.resolve({
        ...before,
        status: operation === "confirm" ? "submitted" : "intake",
      });
      await late;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(result.current.report?.status).toBe("withdrawn");
      expect(result.current.status).toBe("ready");
      expect(result.current.pending).toBeNull();
    },
  );

  it("keeps a newly selected report after the old report's reply completes", async () => {
    const transport = createMemoryTransport();
    const first = await seed(transport, "First report");
    const second = await seed(transport, "Another report");
    const completion = deferred<ReportDetail>();
    vi.spyOn(transport, "reply").mockReturnValueOnce(completion.promise);
    const { result, rerender } = await renderReport(transport, first);
    await expect.poll(() => result.current.status).toBe("ready");
    const before = result.current.report!;
    const late = result.current.reply("Two");
    await expect.poll(() => result.current.pending).toBe("reply");

    await rerender(second);
    expect(result.current.pending).toBeNull();
    await expect.poll(() => result.current.report?.sentence).toBe("Another report");

    completion.resolve(before);
    await late;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.report?.sentence).toBe("Another report");
    expect(result.current.status).toBe("ready");
  });

  it("skips refresh() while a reply is pending and applies the reply's answer", async () => {
    const transport = createMemoryTransport();
    const id = await seed(transport);
    const completion = deferred<ReportDetail>();
    const original = transport.reply.bind(transport);
    vi.spyOn(transport, "reply").mockImplementationOnce(async (key, body) => {
      await completion.promise;
      return original(key, body);
    });
    const { result } = await renderReport(transport, id);
    await expect.poll(() => result.current.status).toBe("ready");
    const get = vi.spyOn(transport, "get");
    const replied = result.current.reply("It should be 12");
    await expect.poll(() => result.current.pending).toBe("reply");
    await result.current.refresh();
    expect(get).not.toHaveBeenCalled();
    expect(result.current.pending).toBe("reply");
    completion.resolve(result.current.report!);
    await replied;
    await expect.poll(() => result.current.report?.pendingSummarySeq).toBe(4);
    expect(result.current.pending).toBeNull();
  });

  it("applies only the newest of two overlapping loads", async () => {
    const transport = createMemoryTransport();
    const id = await seed(transport);
    const { result } = await renderReport(transport, id);
    await expect.poll(() => result.current.status).toBe("ready");
    const base = result.current.report!;
    const slow = deferred<ReportDetail>();
    const fast = deferred<ReportDetail>();
    vi.spyOn(transport, "get").mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const older = result.current.refresh();
    const newer = result.current.refresh();
    fast.resolve({ ...base, title: "Newer" });
    await newer;
    await expect.poll(() => result.current.report?.title).toBe("Newer");
    slow.resolve({ ...base, title: "Older" });
    await older;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.report?.title).toBe("Newer");
  });

  it("applies nothing and reports nothing after unmount", async () => {
    const transport = createMemoryTransport();
    const id = await seed(transport);
    const pending = deferred<ReportDetail>();
    vi.spyOn(transport, "get").mockReturnValueOnce(pending.promise);
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    const { result, unmount } = await renderReport(transport, id, { onError });
    expect(result.current.status).toBe("loading");
    await unmount();
    pending.reject(new Error("late"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ---------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------

describe("reports list", () => {
  it("stays idle until refresh(), then loads and keeps items while refreshing", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    await seed(transport, "Older");
    const { result } = await renderWidget(transport);
    expect(result.current.elicitor.reports.status).toBe("idle");
    expect(calls.list).not.toHaveBeenCalled();

    await result.current.elicitor.reports.refresh();
    await expect.poll(() => result.current.elicitor.reports.status).toBe("ready");
    expect(result.current.elicitor.reports.items.map((item) => item.sentence)).toEqual(["Older"]);

    await seed(transport, "Newer");
    const listed = deferred<void>();
    const original = transport.list.bind(transport);
    calls.list.mockImplementationOnce(async () => {
      await listed.promise;
      return original();
    });
    const refreshing = result.current.elicitor.reports.refresh();
    expect(result.current.elicitor.reports.status).toBe("ready");
    expect(result.current.elicitor.reports.items).toHaveLength(1);
    listed.resolve();
    await refreshing;
    await expect.poll(() => result.current.elicitor.reports.items.length).toBe(2);
    expect(result.current.elicitor.reports.items.map((item) => item.sentence)).toEqual([
      "Newer",
      "Older",
    ]);
  });

  it("adds a submitted report to a loaded list and updates it from report actions", async () => {
    const transport = createMemoryTransport();
    const calls = spied(transport);
    const { result } = await renderWidget(transport);
    await result.current.elicitor.reports.refresh();
    await expect.poll(() => result.current.elicitor.reports.status).toBe("ready");
    expect(result.current.elicitor.reports.items).toEqual([]);

    await result.current.elicitor.open();
    await expect.poll(() => result.current.elicitor.flow.step).toBe("composing");
    const item = await result.current.elicitor.submit("Wrong");
    await expect
      .poll(() => result.current.elicitor.reports.items.map((i) => i.id))
      .toEqual([item.id]);

    await expect.poll(() => result.current.report.status).toBe("ready");
    await result.current.report.withdraw();
    await expect.poll(() => result.current.elicitor.reports.items[0]?.status).toBe("withdrawn");
    expect(calls.list).toHaveBeenCalledTimes(1);
  });

  it("reports a list failure in status and error, and recovers on refresh", async () => {
    const transport = createMemoryTransport();
    const failure = new Error("offline");
    vi.spyOn(transport, "list").mockRejectedValueOnce(failure);
    const onError = vi.fn();
    const { result } = await renderWidget(transport, { onError });
    await result.current.elicitor.reports.refresh();
    await expect.poll(() => result.current.elicitor.reports.status).toBe("error");
    expect(result.current.elicitor.reports.error).toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    await result.current.elicitor.reports.refresh();
    await expect.poll(() => result.current.elicitor.reports.status).toBe("ready");
    expect(result.current.elicitor.reports.error).toBeNull();
  });

  it("applies only the newest of two overlapping list loads", async () => {
    const transport = createMemoryTransport();
    await seed(transport, "Only");
    const slow = deferred<ReadonlyArray<never>>();
    const original = transport.list.bind(transport);
    vi.spyOn(transport, "list")
      .mockReturnValueOnce(slow.promise)
      .mockImplementationOnce(() => original());
    const { result } = await renderWidget(transport);
    const older = result.current.elicitor.reports.refresh();
    await result.current.elicitor.reports.refresh();
    await expect.poll(() => result.current.elicitor.reports.items.length).toBe(1);
    slow.resolve([]);
    await older;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.elicitor.reports.items).toHaveLength(1);
  });
});

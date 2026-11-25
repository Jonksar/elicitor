import {
  createFakeModel,
  createIntake,
  createMemoryStore,
  type ElicitorTransport,
  type Intake,
  isElicitorError,
  type MemoryStore,
  type MemoryStoreOptions,
  type ModelAdapter,
  type ReportDetail,
  type ReportListItem,
  type SystemPromptOptions,
} from "@elicitor/core";
import { ElicitorTransportError } from "./errors.ts";

export interface MemoryTransportOptions {
  /** The model. Default: createFakeModel() (one question, then a summary). */
  readonly model?: ModelAdapter;
  /** The store. Default: createMemoryStore(storeOptions). */
  readonly store?: MemoryStore;
  readonly storeOptions?: MemoryStoreOptions;
  /** Default: a generic product description. */
  readonly prompt?: string | SystemPromptOptions;
  /** Act as the reports' owner. Default true. Change later with actAs(). */
  readonly owner?: boolean;
  /** Milliseconds every call waits before it runs. Default 0. */
  readonly delayMs?: number;
}

export interface MemoryTransport extends ElicitorTransport {
  /**
   * Switches between owner (canReply/canConfirm/canWithdraw as the store decides, and
   * viewerIsReporter true) and another viewer.
   */
  actAs(owner: boolean): void;
  readonly store: MemoryStore;
  readonly intake: Intake;
}

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  not_found: 404,
  invalid: 400,
  stale: 409,
};

/** Core errors become ElicitorTransportError with the status the fetch transport would see. */
const asTransportError = (error: unknown): unknown =>
  isElicitorError(error)
    ? new ElicitorTransportError(STATUS_BY_CODE[error.code] ?? 400, error.code, error.message)
    : error;

/**
 * An in-browser ElicitorTransport over core's intake, fake model and memory store, for tests,
 * demos and UI development. A non-owner gets canReply/canConfirm/canWithdraw false, and its
 * reply/confirm/withdraw calls fail with ElicitorTransportError(403, "forbidden").
 */
export const createMemoryTransport = (options: MemoryTransportOptions = {}): MemoryTransport => {
  const store = options.store ?? createMemoryStore(options.storeOptions);
  const intake = createIntake({
    model: options.model ?? createFakeModel(),
    store,
    prompt: options.prompt ?? { productDescription: "a web application" },
  });
  let owner = options.owner ?? true;
  const delayMs = options.delayMs ?? 0;

  const run = async <T>(body: () => Promise<T>): Promise<T> => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await body();
    } catch (error) {
      throw asTransportError(error);
    }
  };
  const detail = (id: string): ReportDetail => {
    const value = store.toDetail(id, { canAct: owner, viewerIsReporter: owner });
    if (!value) throw new ElicitorTransportError(404, "not_found");
    store.markSeen(id);
    return value;
  };
  const ownerOnly = (): void => {
    if (!owner) throw new ElicitorTransportError(403, "forbidden");
  };

  return {
    store,
    intake,
    actAs(next) {
      owner = next;
    },
    create: (input) =>
      run(async (): Promise<ReportListItem> => {
        const { id } = await intake.start({
          sentence: input.sentence,
          language: input.context.language,
          route: input.route,
          regionText: input.regionText,
          context: input.context,
          screenshotPng: input.screenshotPng || null,
          region: input.region ?? null,
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        });
        const item = store.toListItem(id);
        if (!item) throw new ElicitorTransportError(404, "not_found");
        return item;
      }),
    list: () => run(async () => store.list()),
    get: (id) => run(async () => detail(id)),
    reply: (id, body) =>
      run(async () => {
        ownerOnly();
        await intake.reply(id, body);
        return detail(id);
      }),
    confirm: (id, expectedSeq) =>
      run(async () => {
        ownerOnly();
        await intake.confirm(id, expectedSeq);
        return detail(id);
      }),
    withdraw: (id) =>
      run(async () => {
        ownerOnly();
        await intake.withdraw(id);
      }),
  };
};

import type { RoadmapItem, RoadmapTransport } from "@elicitor/core";
import { useCallback, useEffect, useRef, useState } from "react";

export interface RoadmapState {
  readonly status: "loading" | "ready" | "error";
  readonly items: ReadonlyArray<RoadmapItem>;
  /** The last request error, or null. A vote failure leaves the roadmap ready. */
  readonly error: unknown;
  readonly pendingIds: ReadonlySet<string>;
  /** Reloads the list after pending votes settle. Stores failures in error. */
  reload(): Promise<void>;
  /** Sets one vote optimistically. Reverts the item and stores the error on failure. */
  vote(id: string, voted: boolean): Promise<void>;
}

type Snapshot = Omit<RoadmapState, "reload" | "vote">;

const initial: Snapshot = { status: "loading", items: [], error: null, pendingIds: new Set() };

interface Session {
  readonly transport: RoadmapTransport;
  readonly pending: Map<string, Promise<void>>;
  snapshot: Snapshot;
  load: number;
}

/**
 * Loads a roadmap and keeps its votes in sync with the transport. No provider is needed.
 * The transport must be stable between renders; create it at module scope or with `useMemo`.
 */
export const useRoadmap = (transport: RoadmapTransport): RoadmapState => {
  const session = useRef<Session | null>(null);
  const [stored, setStored] = useState<{
    readonly transport: RoadmapTransport;
    readonly snapshot: Snapshot;
  } | null>(null);

  const update = useCallback((current: Session, patch: Partial<Snapshot>) => {
    if (session.current !== current) return;
    current.snapshot = { ...current.snapshot, ...patch };
    setStored({ transport: current.transport, snapshot: current.snapshot });
  }, []);

  const reload = useCallback(async () => {
    const current = session.current;
    if (!current || current.transport !== transport) return;
    const load = ++current.load;
    const latest = () => session.current === current && current.load === load;
    update(current, { status: "loading", error: null });
    // Start the list request after all writes so a stale list cannot undo a successful vote.
    if (current.pending.size) await Promise.all(current.pending.values());
    if (!latest()) return;
    try {
      const items = await transport.list();
      if (latest()) update(current, { status: "ready", items, error: null });
    } catch (error) {
      if (latest()) {
        update(current, { status: "error", error: error ?? new Error("Roadmap load failed") });
      }
    }
  }, [transport, update]);

  useEffect(() => {
    session.current = { transport, snapshot: initial, load: 0, pending: new Map() };
    void reload();
    return () => {
      session.current = null;
    };
  }, [reload, transport]);

  const vote = useCallback(
    async (id: string, voted: boolean) => {
      const current = session.current;
      if (
        !current ||
        current.transport !== transport ||
        current.snapshot.status !== "ready" ||
        current.pending.has(id)
      ) {
        return;
      }
      const item = current.snapshot.items.find((item) => item.id === id);
      if (!item || item.stage === "shipped" || item.viewerVoted === voted) return;

      const replace = (next: RoadmapItem) =>
        current.snapshot.items.map((item) => (item.id === id ? next : item));
      const completion = Promise.resolve().then(async () => {
        let next = item;
        let failure: unknown = null;
        try {
          next = await transport.vote(id, voted);
        } catch (error) {
          failure = error ?? new Error("Roadmap vote failed");
        }
        current.pending.delete(id);
        update(current, {
          items: replace(next),
          pendingIds: new Set(current.pending.keys()),
          ...(failure !== null ? { error: failure } : {}),
        });
      });
      current.pending.set(id, completion);
      update(current, {
        items: replace({
          ...item,
          votes: Math.max(0, item.votes + (voted ? 1 : -1)),
          viewerVoted: voted,
        }),
        error: null,
        pendingIds: new Set(current.pending.keys()),
      });
      await completion;
    },
    [transport, update],
  );

  const snapshot = stored?.transport === transport ? stored.snapshot : initial;
  return { ...snapshot, reload, vote };
};

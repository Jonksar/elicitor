import type { RoadmapItem, RoadmapTransport } from "@elicitor/core";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { createMemoryRoadmapTransport } from "./testing.ts";
import { useRoadmap } from "./use-roadmap.ts";

const giftWrap: RoadmapItem = {
  id: "wrap",
  title: "Gift wrap",
  description: "Add gift wrap at checkout.",
  stage: "planned",
  votes: 4,
  viewerVoted: false,
};
const tracking: RoadmapItem = { ...giftWrap, id: "tracking", title: "Order tracking" };

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe("useRoadmap", () => {
  it("votes optimistically, coalesces duplicate submissions, and uses the server total", async () => {
    const transport = createMemoryRoadmapTransport([giftWrap, tracking], { userId: "lee" });
    const completion = deferred<RoadmapItem>();
    const vote = vi.spyOn(transport, "vote").mockReturnValueOnce(completion.promise);
    const { result } = await renderHook(() => useRoadmap(transport));
    await expect.poll(() => result.current.status).toBe("ready");

    const first = result.current.vote(giftWrap.id, true);
    await result.current.vote(giftWrap.id, true);
    await expect.poll(() => result.current.items[0]?.votes).toBe(5);
    expect(result.current.items[0]?.viewerVoted).toBe(true);
    expect(result.current.pendingIds.has(giftWrap.id)).toBe(true);
    expect(vote).toHaveBeenCalledExactlyOnceWith(giftWrap.id, true);

    await result.current.vote(tracking.id, true);
    await expect.poll(() => result.current.items[1]?.viewerVoted).toBe(true);
    expect(transport.roadmap.list("lee")[1]?.viewerVoted).toBe(true);
    expect(transport.roadmap.list("other")[1]?.viewerVoted).toBe(false);
    const serverItem = { ...giftWrap, votes: 12, viewerVoted: true, title: "Gift wrapping" };
    completion.resolve(serverItem);
    await first;
    await expect.poll(() => result.current.items[0]).toEqual(serverItem);
    expect(result.current.pendingIds.size).toBe(0);
  });

  it("rolls back only the failed vote, reports its error, and allows a retry", async () => {
    const transport = createMemoryRoadmapTransport([giftWrap, tracking]);
    const failed = deferred<RoadmapItem>();
    vi.spyOn(transport, "vote").mockReturnValueOnce(failed.promise);
    const { result } = await renderHook(() => useRoadmap(transport));
    await expect.poll(() => result.current.status).toBe("ready");

    const first = result.current.vote(giftWrap.id, true);
    await expect.poll(() => result.current.items[0]?.viewerVoted).toBe(true);
    await result.current.vote(tracking.id, true);
    const error = new Error("offline");
    failed.reject(error);
    await first;
    await expect.poll(() => result.current.error).toBe(error);
    expect(result.current.items[0]).toEqual(giftWrap);
    expect(result.current.items[1]?.viewerVoted).toBe(true);
    expect(result.current.pendingIds.size).toBe(0);

    await result.current.vote(giftWrap.id, true);
    await expect.poll(() => result.current.items[0]?.viewerVoted).toBe(true);
    expect(result.current.error).toBeNull();
    await result.current.vote(giftWrap.id, false);
    await expect.poll(() => result.current.items[0]).toEqual(giftWrap);
  });

  it("reloads after pending votes settle and ignores outdated list responses", async () => {
    const transport = createMemoryRoadmapTransport([giftWrap]);
    const { result, rerender } = await renderHook(() => useRoadmap(transport));
    await expect.poll(() => result.current.status).toBe("ready");
    const older = deferred<ReadonlyArray<RoadmapItem>>();
    const list = vi.spyOn(transport, "list").mockReturnValueOnce(older.promise);
    const completion = deferred<void>();
    const vote = transport.vote;
    vi.spyOn(transport, "vote").mockImplementationOnce(async (id, voted) => {
      await completion.promise;
      return vote(id, voted);
    });

    const saving = result.current.vote(giftWrap.id, true);
    const first = result.current.reload();
    expect(list).not.toHaveBeenCalled();
    completion.resolve();
    await saving;
    await expect.poll(() => list.mock.calls.length).toBe(1);
    await result.current.reload();
    await expect
      .poll(() => [result.current.status, result.current.items[0]?.viewerVoted])
      .toEqual(["ready", true]);

    older.resolve([giftWrap]);
    await first;
    await rerender();
    expect(result.current.items[0]?.viewerVoted).toBe(true);
  });

  it("reloads a new transport and clears an initial list error on retry", async () => {
    const older = deferred<ReadonlyArray<RoadmapItem>>();
    const old: RoadmapTransport = { list: () => older.promise, vote: vi.fn() };
    const next = createMemoryRoadmapTransport([tracking]);
    const error = new Error("list failed");
    vi.spyOn(next, "list").mockRejectedValueOnce(error);
    const { result, rerender } = await renderHook((transport = old) => useRoadmap(transport), {
      initialProps: old,
    });
    await rerender(next);
    await expect.poll(() => result.current.status).toBe("error");
    expect(result.current.error).toBe(error);
    older.resolve([giftWrap]);
    await result.current.reload();
    await expect.poll(() => result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([tracking]);
  });
});

import { describe, expect, test } from "vitest";
import { createMemoryRoadmap, ElicitorError, type RoadmapItem } from "./index.ts";

const item: RoadmapItem = {
  id: "exports",
  title: "Export reports",
  description: "Download reports as a spreadsheet.",
  stage: "planned",
  votes: 3,
  viewerVoted: false,
  url: "https://example.com/exports",
};

describe("createMemoryRoadmap", () => {
  test("counts one vote per user and leaves the seed count when votes are removed", async () => {
    const roadmap = createMemoryRoadmap([item]);
    expect(roadmap.list("alice")).toEqual([item]);
    expect(await roadmap.vote("alice", item.id, true)).toEqual({
      ...item,
      votes: 4,
      viewerVoted: true,
    });
    await roadmap.vote("alice", item.id, true);
    expect(roadmap.list("bob")).toEqual([{ ...item, votes: 4 }]);
    await roadmap.vote("bob", item.id, true);
    await roadmap.vote("alice", item.id, false);
    await roadmap.vote("alice", item.id, false);
    expect(roadmap.list("alice")).toEqual([{ ...item, votes: 4 }]);
    expect(roadmap.list("bob")).toEqual([{ ...item, votes: 4, viewerVoted: true }]);
    expect(await roadmap.vote("bob", item.id, false)).toEqual(item);
  });

  test("associates initial viewer votes with the supplied user without counting them twice", async () => {
    const roadmap = createMemoryRoadmap([{ ...item, viewerVoted: true }], { userId: "alice" });
    expect(roadmap.list("alice")).toEqual([{ ...item, viewerVoted: true }]);
    expect(roadmap.list("bob")).toEqual([item]);
    expect(await roadmap.vote("alice", item.id, false)).toEqual({ ...item, votes: 2 });

    const zero = createMemoryRoadmap([{ ...item, votes: 0, viewerVoted: true }], {
      userId: "alice",
    });
    expect(zero.list("alice")).toEqual([{ ...item, votes: 1, viewerVoted: true }]);
    expect(await zero.vote("alice", item.id, false)).toEqual({ ...item, votes: 0 });
  });

  test("ignores initial viewer flags when no user identity was supplied", () => {
    const roadmap = createMemoryRoadmap([{ ...item, viewerVoted: true }]);
    expect(roadmap.list("alice")).toEqual([item]);
  });

  test("rejects votes for unknown and shipped items without changing their counts", async () => {
    const shipped = { ...item, stage: "shipped" as const };
    const roadmap = createMemoryRoadmap([shipped]);
    for (const voted of [true, false]) {
      await expect(roadmap.vote("alice", "missing", voted)).rejects.toBeInstanceOf(ElicitorError);
      await expect(roadmap.vote("alice", "missing", voted)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(roadmap.vote("alice", item.id, voted)).rejects.toMatchObject({
        code: "invalid",
      });
    }
    expect(roadmap.list("alice")).toEqual([shipped]);
  });

  test("replaces seed data while preserving votes only for retained IDs", async () => {
    const roadmap = createMemoryRoadmap([item]);
    await roadmap.vote("alice", item.id, true);
    roadmap.set([
      { ...item, title: "Export everything", votes: 10, viewerVoted: true },
      { ...item, id: "search", votes: 0, viewerVoted: true },
    ]);
    expect(roadmap.list("alice")).toEqual([
      { ...item, title: "Export everything", votes: 11, viewerVoted: true },
      { ...item, id: "search", votes: 0 },
    ]);
    roadmap.set([]);
    expect(roadmap.list("alice")).toEqual([]);
    roadmap.set([item]);
    expect(roadmap.list("alice")).toEqual([item]);
  });

  test("returns copies and keeps copies of supplied items", async () => {
    const source = { ...item };
    const roadmap = createMemoryRoadmap([source]);
    source.title = "Changed outside";
    const listed = roadmap.list("alice")[0] as { title: string };
    listed.title = "Changed snapshot";
    const voted = (await roadmap.vote("alice", item.id, true)) as { title: string };
    voted.title = "Changed vote result";
    expect(roadmap.list("alice")).toEqual([{ ...item, votes: 4, viewerVoted: true }]);
    roadmap.set([source]);
    source.title = "Changed after set";
    expect(roadmap.list("alice")).toEqual([
      { ...item, title: "Changed outside", votes: 4, viewerVoted: true },
    ]);
  });
});

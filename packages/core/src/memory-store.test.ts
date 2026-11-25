import { describe, expect, test } from "vitest";
import { createMemoryStore, pendingSummaryOf } from "./memory-store.ts";
import type { NewReport, StoredMessage, Turn } from "./types.ts";

const summaryTurn: Turn = {
  kind: "summary",
  text: "Is this right?",
  summary: {
    title: "T".repeat(250),
    kind: "screen",
    expected: "A button",
    actual: "No button",
    steps: ["Open the list"],
    publicSummary: "A button is missing on the list screen.",
  },
};

const input: NewReport = {
  sentence: "S".repeat(100),
  language: "en",
  route: "/orders",
  regionText: ["Orders"],
  context: { nested: { value: 1 } },
  screenshotPng: "iVBORw0KGgo=",
  metadata: { owner: "user-1" },
};

const clock = () => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
};

describe("pendingSummaryOf", () => {
  const message = (seq: number, author: StoredMessage["author"], turn: Turn | null) => ({
    seq,
    author,
    body: "x",
    turn,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  test("is the latest message only when it is an agent summary in intake", () => {
    const messages = [message(1, "reporter", null), message(2, "agent", summaryTurn)];
    expect(pendingSummaryOf(messages, "intake")).toEqual({ summary: summaryTurn.summary, seq: 2 });
    expect(pendingSummaryOf(messages, "submitted")).toBeNull();
    expect(pendingSummaryOf([...messages, message(3, "reporter", null)], "intake")).toBeNull();
    expect(
      pendingSummaryOf([message(1, "agent", { kind: "question", text: "Q?" })], "intake"),
    ).toBeNull();
    expect(pendingSummaryOf([], "intake")).toBeNull();
  });
});

describe("createMemoryStore", () => {
  test("creates in intake with the sentence as seq 1 and a title cut to 80", async () => {
    const store = createMemoryStore({ now: clock(), newId: () => "r1" });
    expect(await store.create(input)).toEqual({ id: "r1", seq: 1 });
    expect(await store.get("r1")).toEqual({
      id: "r1",
      status: "intake",
      title: "S".repeat(80),
      messages: [
        {
          seq: 1,
          author: "reporter",
          body: input.sentence,
          turn: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      summary: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      statusChangedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await store.loadCapture("r1")).toEqual({
      language: "en",
      route: "/orders",
      regionText: ["Orders"],
      context: { nested: { value: 1 } },
      screenshotPng: "iVBORw0KGgo=",
    });
    expect(store.metadataOf("r1")).toEqual({ owner: "user-1" });
    expect(await store.get("missing")).toBeNull();
    expect(await store.loadCapture("missing")).toBeNull();
  });

  test("returns copies that callers cannot use to change the store", async () => {
    const store = createMemoryStore();
    const { id } = await store.create(input);
    const report = await store.get(id);
    (report!.messages as Array<StoredMessage>).push({ ...report!.messages[0]!, seq: 2 });
    const capture = await store.loadCapture(id);
    (capture!.regionText as Array<string>).push("changed");
    expect((await store.get(id))?.messages).toHaveLength(1);
    expect((await store.loadCapture(id))?.regionText).toEqual(["Orders"]);
  });

  test("commits a turn only in intake at the expected seq", async () => {
    const store = createMemoryStore({ now: clock() });
    const { id } = await store.create(input);
    const question: Turn = { kind: "question", text: "Which list?" };
    expect(await store.commitTurn(id, 0, { kind: "turn", turn: question })).toBe(false);
    expect(await store.commitTurn(id, 1, { kind: "turn", turn: question })).toBe(true);
    expect(await store.commitTurn(id, 1, { kind: "turn", turn: question })).toBe(false);
    const report = await store.get(id);
    expect(report?.messages[1]).toMatchObject({ seq: 2, author: "agent", body: "Which list?" });
    expect(report?.messages[1]?.turn).toEqual(question);
    // An agent turn does not change the status time.
    expect(report?.statusChangedAt).toBe(report?.createdAt);
    expect(await store.commitTurn("missing", 1, { kind: "turn", turn: question })).toBe(false);
  });

  test("an unavailable outcome appends a system note and submits", async () => {
    const store = createMemoryStore({ now: clock() });
    const { id } = await store.create(input);
    expect(
      await store.commitTurn(id, 1, { kind: "unavailable", note: "Sent.", reason: "gateway" }),
    ).toBe(true);
    const report = await store.get(id);
    expect(report?.status).toBe("submitted");
    expect(report?.messages[1]).toMatchObject({ author: "system", body: "Sent.", turn: null });
    expect(report?.statusChangedAt).not.toBe(report?.createdAt);
    expect(await store.appendReporterMessage(id, "More")).toEqual({
      ok: false,
      reason: "not_intake",
    });
    expect(await store.appendReporterMessage("missing", "More")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  test("confirms only the latest summary and keeps its title cut to 200", async () => {
    const store = createMemoryStore({ now: clock() });
    const { id } = await store.create(input);
    await store.commitTurn(id, 1, { kind: "turn", turn: summaryTurn });
    expect(await store.confirm(id, 1)).toBe("stale");
    expect(await store.confirm("missing", 2)).toBe("not_found");
    expect(await store.confirm(id, 2)).toBe("confirmed");
    const report = await store.get(id);
    expect(report?.status).toBe("submitted");
    expect(report?.summary).toEqual(summaryTurn.summary);
    expect(report?.title).toBe("T".repeat(200));
    expect(await store.confirm(id, 2)).toBe("stale");
  });

  test("withdraws from intake and submitted only", async () => {
    const store = createMemoryStore();
    const { id } = await store.create(input);
    expect(await store.withdraw(id)).toBe("withdrawn");
    expect(await store.withdraw(id)).toBe("not_allowed");
    expect(await store.withdraw("missing")).toBe("not_found");
    const other = await store.create(input);
    store.setStatus(other.id, "fixed");
    expect(await store.withdraw(other.id)).toBe("not_allowed");
    expect(store.setStatus("missing", "fixed")).toBe(false);
  });

  test("maps to wire types with pending summary, unread and host-decided controls", async () => {
    const store = createMemoryStore({ now: clock(), newId: () => `r${Math.random()}` });
    const { id } = await store.create({
      ...input,
      region: { x: 1, y: 2, width: 3, height: 4, viewportWidth: 5, viewportHeight: 6 },
    });
    await store.commitTurn(id, 1, { kind: "turn", turn: summaryTurn });
    const detail = store.toDetail(id, { canAct: true });
    expect(detail).toEqual({
      id,
      number: 1,
      status: "intake",
      title: "S".repeat(80),
      sentence: input.sentence,
      createdAt: "2026-01-01T00:00:00.000Z",
      statusChangedAt: "2026-01-01T00:00:00.000Z",
      unread: true,
      route: "/orders",
      region: { x: 1, y: 2, width: 3, height: 4, viewportWidth: 5, viewportHeight: 6 },
      messages: [
        { seq: 1, author: "reporter", body: input.sentence, createdAt: "2026-01-01T00:00:00.000Z" },
        { seq: 2, author: "agent", body: "Is this right?", createdAt: "2026-01-01T00:00:01.000Z" },
      ],
      screenshotPng: "iVBORw0KGgo=",
      pendingSummary: summaryTurn.summary,
      pendingSummarySeq: 2,
      summary: null,
      canReply: true,
      canConfirm: true,
      canWithdraw: true,
      viewerIsReporter: true,
    });
    expect(store.toDetail(id, { canAct: false })).toMatchObject({
      canReply: false,
      canConfirm: false,
      canWithdraw: false,
      viewerIsReporter: false,
    });
    // An operator may act without having filed the report.
    expect(store.toDetail(id, { canAct: true, viewerIsReporter: false })).toMatchObject({
      canReply: true,
      viewerIsReporter: false,
    });
    store.markSeen(id);
    expect(store.toListItem(id)?.unread).toBe(false);
    await store.withdraw(id);
    expect(store.toListItem(id)?.unread).toBe(true);
    expect(store.toDetail("missing", { canAct: true })).toBeNull();
    expect(store.toListItem("missing")).toBeNull();
  });

  test("lists newest first and filters by metadata", async () => {
    const store = createMemoryStore({ now: clock() });
    const first = await store.create(input);
    const second = await store.create({ ...input, metadata: { owner: "user-2" } });
    expect(store.list().map((item) => item.id)).toEqual([second.id, first.id]);
    expect(store.list((metadata) => metadata.owner === "user-1").map((item) => item.id)).toEqual([
      first.id,
    ]);
    const sameTime = createMemoryStore({ now: () => "2026-01-01T00:00:00.000Z" });
    const a = await sameTime.create(input);
    const b = await sameTime.create(input);
    expect(sameTime.list().map((item) => item.number)).toEqual([2, 1]);
    expect(sameTime.list().map((item) => item.id)).toEqual([b.id, a.id]);
  });
});

import type { CreateReportInput, ReportDetail, ReportListItem } from "@elicitor/core";
import { describe, expect, it } from "vitest";
import { ElicitorTransportError, isElicitorTransportError } from "./errors.ts";
import { createFetchTransport } from "./fetch-transport.ts";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
  readonly credentials: RequestCredentials | undefined;
  readonly hasCredentials: boolean;
}

const fakeFetch = (respond: (call: Call) => Response) => {
  const calls: Array<Call> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      credentials: init?.credentials,
      hasCredentials: init !== undefined && "credentials" in init,
    };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
};

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const item: ReportListItem = {
  id: "r/1 ?",
  number: 1,
  status: "intake",
  title: "Wrong total",
  sentence: "Wrong total",
  createdAt: "2026-01-01T00:00:00.000Z",
  statusChangedAt: "2026-01-01T00:00:00.000Z",
  unread: false,
};

const detail: ReportDetail = {
  ...item,
  route: "/orders",
  region: null,
  messages: [{ seq: 1, author: "reporter", body: "Wrong total", createdAt: item.createdAt }],
  screenshotPng: null,
  pendingSummary: null,
  pendingSummarySeq: null,
  summary: null,
  canReply: true,
  canConfirm: false,
  canWithdraw: true,
};

const input: CreateReportInput = {
  sentence: "Wrong total",
  route: "/orders?page=2",
  regionText: ["Total 10"],
  context: {
    language: "en",
    viewport: { width: 800, height: 600 },
    userAgent: "test",
    bundleId: "dev",
    requestLog: [],
    consoleErrors: [],
  },
  screenshotPng: "",
  metadata: { workspace: "w-1" },
};

describe("createFetchTransport", () => {
  it("sends each operation with the documented method, path and body", async () => {
    const { calls, fetch } = fakeFetch((call) =>
      call.url.endsWith("/withdraw")
        ? new Response(null, { status: 204 })
        : call.method === "GET" && call.url.endsWith("/reports")
          ? json([item])
          : call.url.endsWith("/reports")
            ? json(item, 201)
            : json(detail),
    );
    const transport = createFetchTransport("https://example.test/api/elicitor/", { fetch });

    expect(await transport.create(input)).toEqual(item);
    expect(await transport.list()).toEqual([item]);
    expect(await transport.get(item.id)).toEqual(detail);
    expect(await transport.reply(item.id, "It should be 12")).toEqual(detail);
    expect(await transport.confirm(item.id, 3)).toEqual(detail);
    expect(await transport.withdraw(item.id)).toBeUndefined();

    const encoded = encodeURIComponent(item.id);
    expect(calls.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: "POST", url: "https://example.test/api/elicitor/reports", body: input },
      { method: "GET", url: "https://example.test/api/elicitor/reports", body: undefined },
      {
        method: "GET",
        url: `https://example.test/api/elicitor/reports/${encoded}`,
        body: undefined,
      },
      {
        method: "POST",
        url: `https://example.test/api/elicitor/reports/${encoded}/reply`,
        body: { body: "It should be 12" },
      },
      {
        method: "POST",
        url: `https://example.test/api/elicitor/reports/${encoded}/confirm`,
        body: { expectedSeq: 3 },
      },
      {
        method: "POST",
        url: `https://example.test/api/elicitor/reports/${encoded}/withdraw`,
        body: undefined,
      },
    ]);
    expect(encoded).toBe("r%2F1%20%3F");
    expect(calls[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(calls[1]?.headers.get("Content-Type")).toBeNull();
    expect(calls.every((call) => call.headers.get("Accept") === "application/json")).toBe(true);
    expect(calls.every((call) => !call.hasCredentials)).toBe(true);
  });

  it("resolves a header function on every request and passes credentials", async () => {
    const { calls, fetch } = fakeFetch(() => json([]));
    let token = 0;
    const transport = createFetchTransport("/api", {
      fetch,
      credentials: "include",
      headers: async () => ({ Authorization: `Bearer t${++token}` }),
    });
    await transport.list();
    await transport.list();
    expect(calls.map((call) => call.headers.get("Authorization"))).toEqual([
      "Bearer t1",
      "Bearer t2",
    ]);
    expect(calls.map((call) => call.credentials)).toEqual(["include", "include"]);
    expect(calls[0]?.url).toBe("/api/reports");
  });

  it("accepts static headers", async () => {
    const { calls, fetch } = fakeFetch(() => json([]));
    await createFetchTransport("/api", { fetch, headers: [["X-Workspace", "w-1"]] }).list();
    expect(calls[0]?.headers.get("X-Workspace")).toBe("w-1");
  });

  it("maps a JSON error body to status and code", async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: { code: "stale", message: "There is no pending summary" } }, 409),
    );
    const error = await createFetchTransport("/api", { fetch })
      .confirm("r1", 2)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ElicitorTransportError);
    expect(isElicitorTransportError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 409,
      code: "stale",
      message: "There is no pending summary",
    });
  });

  it("keeps the status when the error body is not JSON or has no code", async () => {
    const plain = fakeFetch(() => new Response("Bad gateway", { status: 502 }));
    await expect(createFetchTransport("/api", { fetch: plain.fetch }).list()).rejects.toMatchObject(
      { status: 502, code: null },
    );
    const noCode = fakeFetch(() => json({ message: "nope" }, 403));
    await expect(
      createFetchTransport("/api", { fetch: noCode.fetch }).get("r1"),
    ).rejects.toMatchObject({ status: 403, code: null });
  });

  it("wraps a failed fetch as a network error and a non-JSON success as invalid_response", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof globalThis.fetch;
    const network = await createFetchTransport("/api", { fetch: failing })
      .list()
      .catch((cause: unknown) => cause);
    expect(network).toMatchObject({ status: 0, code: "network" });
    expect((network as Error).cause).toBeInstanceOf(TypeError);

    const html = fakeFetch(() => new Response("<html>", { status: 200 }));
    await expect(createFetchTransport("/api", { fetch: html.fetch }).list()).rejects.toMatchObject({
      status: 200,
      code: "invalid_response",
    });
  });

  it("uses the global fetch at call time when none is given", async () => {
    const original = globalThis.fetch;
    const { calls, fetch } = fakeFetch(() => json([]));
    const transport = createFetchTransport("/api");
    globalThis.fetch = fetch;
    try {
      await transport.list();
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toHaveLength(1);
  });
});

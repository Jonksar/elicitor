import Anthropic, { APIError } from "@anthropic-ai/sdk";
import {
  buildSystemPrompt,
  createIntake,
  createMemoryStore,
  IntakeUnavailable,
  type IntakeUnavailableReason,
  isIntakeUnavailable,
  type ModelRequest,
  type NewReport,
} from "@elicitor/core";
import { TURN_JSON_SCHEMA } from "@elicitor/core/engine";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { anthropicModel } from "./index.ts";

const GATEWAY = "https://gateway.example/anthropic";

interface Call {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
  readonly signal: AbortSignal | null;
}

const message = (
  content: ReadonlyArray<Record<string, unknown>>,
  stopReason = "end_turn",
): Record<string, unknown> => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "test-model",
  content,
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

const textMessage = (text: string): Record<string, unknown> => message([{ type: "text", text }]);

/** A fake fetch that records every request and answers each with `respond`. */
const fakeFetch = (
  respond: () => Response = () => Response.json(textMessage('{"kind":"question","text":"?"}')),
) => {
  const calls: Array<Call> = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      signal: init?.signal ?? null,
    });
    return respond();
  });
  return { fetch, calls };
};

const clientWith = (fetch: typeof globalThis.fetch): Anthropic =>
  new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 });

const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  system: "You take bug reports.",
  messages: [
    { role: "user", content: "Capture and first sentence" },
    { role: "assistant", content: "Which page?" },
    { role: "user", content: "The invoice list" },
  ],
  outputSchema: TURN_JSON_SCHEMA,
  ...overrides,
});

const reasonOf = async (promise: Promise<unknown>): Promise<IntakeUnavailableReason | null> => {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(isIntakeUnavailable(error)).toBe(true);
  return (error as IntakeUnavailable).reason;
};

beforeEach(() => {
  // Never let a developer's real credentials or endpoint into these tests.
  vi.stubEnv("ANTHROPIC_API_KEY", undefined);
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined);
  vi.stubEnv("ANTHROPIC_BASE_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("request shape", () => {
  test("sends exactly the documented body with the defaults", async () => {
    const { fetch, calls } = fakeFetch();
    await anthropicModel({ client: clientWith(fetch) }).complete(request());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: TURN_JSON_SCHEMA },
      },
      system: [
        { type: "text", text: "You take bug reports.", cache_control: { type: "ephemeral" } },
      ],
      messages: [
        { role: "user", content: "Capture and first sentence" },
        { role: "assistant", content: "Which page?" },
        { role: "user", content: "The invoice list" },
      ],
    });
    expect(calls[0]?.body).not.toHaveProperty("fallbacks");
    expect(calls[0]?.body).not.toHaveProperty("tools");
  });

  test("applies model, effort, max tokens and thinking overrides", async () => {
    const { fetch, calls } = fakeFetch();
    await anthropicModel({
      client: clientWith(fetch),
      model: "claude-sonnet-5-5",
      effort: "high",
      maxTokens: 1234,
      thinking: "off",
    }).complete(request());
    const body = calls[0]?.body;
    expect(body?.model).toBe("claude-sonnet-5-5");
    expect(body?.max_tokens).toBe(1234);
    expect(body?.output_config).toEqual({
      effort: "high",
      format: { type: "json_schema", schema: TURN_JSON_SCHEMA },
    });
    expect(body).not.toHaveProperty("thinking");
  });

  test("attaches the images to the first user message, before its text", async () => {
    const { fetch, calls } = fakeFetch();
    await anthropicModel({ client: clientWith(fetch) }).complete(
      request({ images: [{ png: "iVBORw0KGgo=" }, { png: "AAAA" }] }),
    );
    expect(calls[0]?.body.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
          },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          { type: "text", text: "Capture and first sentence" },
        ],
      },
      { role: "assistant", content: "Which page?" },
      { role: "user", content: "The invoice list" },
    ]);
  });

  test("keeps plain string content when there are no images", async () => {
    const { fetch, calls } = fakeFetch();
    await anthropicModel({ client: clientWith(fetch) }).complete(request({ images: [] }));
    expect(calls[0]?.body.messages).toEqual(request().messages);
  });

  test("passes the abort signal to the client unchanged", async () => {
    const create = vi.fn(async () => textMessage("{}"));
    const stub = { messages: { create } } as unknown as Anthropic;
    const controller = new AbortController();
    await anthropicModel({ client: stub }).complete(request({ signal: controller.signal }));
    expect(create).toHaveBeenCalledWith(expect.any(Object), { signal: controller.signal });
  });

  test("an aborted request is a gateway failure", async () => {
    const { fetch } = fakeFetch();
    const controller = new AbortController();
    controller.abort();
    const reason = await reasonOf(
      anthropicModel({ client: clientWith(fetch) }).complete(
        request({ signal: controller.signal }),
      ),
    );
    expect(reason).toBe("gateway");
    for (const call of fetch.mock.calls) expect(call[1]?.signal?.aborted).toBe(true);
  });
});

describe("constructed client", () => {
  test("sends the gateway headers to the base URL, with a placeholder key", async () => {
    const { fetch, calls } = fakeFetch();
    vi.stubGlobal("fetch", fetch);
    await anthropicModel({
      baseURL: GATEWAY,
      defaultHeaders: { "x-gateway-key": "gateway-secret" },
      maxRetries: 0,
    }).complete(request());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${GATEWAY}/v1/messages`);
    expect(calls[0]?.headers.get("x-gateway-key")).toBe("gateway-secret");
    // SDK 1.8 sends the key as a bearer token.
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer gateway-auth-by-headers");
    expect(calls[0]?.body.model).toBe("claude-opus-5-5");
  });

  test("a gateway Authorization header wins over the placeholder key", async () => {
    const { fetch, calls } = fakeFetch();
    vi.stubGlobal("fetch", fetch);
    await anthropicModel({
      baseURL: GATEWAY,
      defaultHeaders: { Authorization: "Basic dXNlcjpwYXNz", "x-gateway-key": "gateway-secret" },
      maxRetries: 0,
    }).complete(request());
    expect(calls[0]?.headers.get("authorization")).toBe("Basic dXNlcjpwYXNz");
    expect(calls[0]?.headers.get("x-gateway-key")).toBe("gateway-secret");
  });

  test("uses an explicit key with the gateway", async () => {
    const { fetch, calls } = fakeFetch();
    vi.stubGlobal("fetch", fetch);
    await anthropicModel({ apiKey: "sk-test", baseURL: GATEWAY, maxRetries: 0 }).complete(
      request(),
    );
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer sk-test");
  });

  test("never sends ANTHROPIC_API_KEY to a gateway", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "env-test-key");
    const { fetch, calls } = fakeFetch();
    vi.stubGlobal("fetch", fetch);
    await anthropicModel({ baseURL: GATEWAY, maxRetries: 0 }).complete(request());
    expect(calls[0]?.url).toBe(`${GATEWAY}/v1/messages`);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer gateway-auth-by-headers");
    expect(calls[0]?.headers.get("x-api-key")).toBeNull();
    const values = [...(calls[0]?.headers.values() ?? [])];
    expect(values.join("\n")).not.toContain("env-test-key");
  });

  test("falls back to ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "env-test-key");
    const { fetch, calls } = fakeFetch();
    vi.stubGlobal("fetch", fetch);
    await anthropicModel({ maxRetries: 0 }).complete(request());
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer env-test-key");
  });

  test("is not configured without client, key, base URL or environment key, and sends nothing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { fetch } = fakeFetch();
    vi.stubGlobal("fetch", fetch);
    const model = anthropicModel();
    expect(await reasonOf(model.complete(request()))).toBe("not_configured");
    expect(await reasonOf(anthropicModel({ apiKey: "" }).complete(request()))).toBe(
      "not_configured",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("responses and errors", () => {
  test("concatenates the text blocks and skips the others", async () => {
    const { fetch } = fakeFetch(() =>
      Response.json(
        message([
          { type: "thinking", thinking: "hidden", signature: "sig" },
          { type: "text", text: '{"kind":"question",' },
          { type: "text", text: '"text":"Which page?"}' },
        ]),
      ),
    );
    expect(await anthropicModel({ client: clientWith(fetch) }).complete(request())).toBe(
      '{"kind":"question","text":"Which page?"}',
    );
  });

  test("returns an empty string when there is no text (core treats it as invalid output)", async () => {
    const { fetch } = fakeFetch(() => Response.json(message([])));
    expect(await anthropicModel({ client: clientWith(fetch) }).complete(request())).toBe("");
  });

  test("maps a refusal to refusal", async () => {
    const { fetch } = fakeFetch(() => Response.json(message([], "refusal")));
    expect(await reasonOf(anthropicModel({ client: clientWith(fetch) }).complete(request()))).toBe(
      "refusal",
    );
  });

  test("maps an HTTP 500 to gateway, with the SDK error as cause", async () => {
    const { fetch } = fakeFetch(() =>
      Response.json(
        { type: "error", error: { type: "api_error", message: "boom" } },
        { status: 500 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const promise = anthropicModel({ baseURL: GATEWAY, maxRetries: 0 }).complete(request());
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(IntakeUnavailable);
    expect((error as IntakeUnavailable).reason).toBe("gateway");
    expect((error as IntakeUnavailable).cause).toBeInstanceOf(APIError);
    expect(((error as IntakeUnavailable).cause as APIError).status).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("maps a network failure to gateway", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await reasonOf(anthropicModel({ client: clientWith(fetch) }).complete(request()))).toBe(
      "gateway",
    );
  });
});

describe("with createIntake", () => {
  const report: NewReport = {
    sentence: "The total on the invoice list is wrong",
    language: "en",
    route: "/invoices",
    regionText: ["Total 1234"],
    context: { bundleId: "index-test.js" },
    screenshotPng: "iVBORw0KGgo=",
  };
  const summary = {
    title: "Invoice list total is wrong",
    kind: "figure",
    expected: "1200",
    actual: "1234",
    steps: ["Open the invoice list"],
    publicSummary: "The total on the invoice list does not match its rows.",
  };

  const run = async (respond: () => Response) => {
    const { fetch, calls } = fakeFetch(respond);
    const store = createMemoryStore();
    const onUnavailable = vi.fn();
    const intake = createIntake({
      model: anthropicModel({ client: clientWith(fetch) }),
      store,
      prompt: { productDescription: "Acme Books, an online bookkeeping application" },
      onUnavailable,
    });
    const { id } = await intake.start(report);
    return { report: (await store.get(id))!, calls, onUnavailable };
  };

  test("a valid JSON reply becomes the agent's question, sent with the capture", async () => {
    const result = await run(() =>
      Response.json(textMessage('{"kind":"question","text":"What should the total be?"}')),
    );
    expect(result.report.status).toBe("intake");
    expect(result.report.messages.at(-1)?.turn).toEqual({
      kind: "question",
      text: "What should the total be?",
    });
    const body = result.calls[0]!.body;
    expect(JSON.stringify(body.system)).toBe(
      JSON.stringify([
        {
          type: "text",
          text: buildSystemPrompt({
            productDescription: "Acme Books, an online bookkeeping application",
          }),
          cache_control: { type: "ephemeral" },
        },
      ]),
    );
    const first = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]!;
    expect(first.content[0]?.type).toBe("image");
    expect(String(first.content[1]?.text)).toContain("The total on the invoice list is wrong");
    expect(result.onUnavailable).not.toHaveBeenCalled();
  });

  test("prose from a gateway that dropped the format is kept as a question", async () => {
    const result = await run(() => Response.json(textMessage("Which month is it?")));
    expect(result.report.messages.at(-1)?.turn).toEqual({
      kind: "question",
      text: "Which month is it?",
    });
  });

  test("fenced JSON is parsed into a summary", async () => {
    const fenced = `\`\`\`json\n${JSON.stringify({ kind: "summary", text: "Is this right?", summary })}\n\`\`\``;
    const result = await run(() => Response.json(textMessage(fenced)));
    expect(result.report.status).toBe("intake");
    expect(result.report.messages.at(-1)?.turn).toEqual({
      kind: "summary",
      text: "Is this right?",
      summary,
    });
  });

  test("a refusal submits the report as written", async () => {
    const result = await run(() => Response.json(message([], "refusal")));
    expect(result.report.status).toBe("submitted");
    expect(result.onUnavailable).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "refusal" }),
    );
  });
});

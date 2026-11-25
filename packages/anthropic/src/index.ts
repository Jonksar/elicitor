import Anthropic from "@anthropic-ai/sdk";
import { IntakeUnavailable, type ModelAdapter, type ModelRequest } from "@elicitor/core";

export interface AnthropicModelOptions {
  /** A ready client. When given, apiKey, baseURL, defaultHeaders, timeoutMs and maxRetries are unused. */
  readonly client?: Anthropic;
  /** Defaults to the ANTHROPIC_API_KEY environment variable. */
  readonly apiKey?: string;
  /**
   * A gateway or proxy in front of the Messages API. A gateway that authenticates by headers needs
   * no apiKey: a placeholder key is then sent so the SDK constructs (as `Authorization: Bearer
   * gateway-auth-by-headers`; an Authorization header in defaultHeaders replaces it).
   */
  readonly baseURL?: string;
  /** Sent with every request, for example a gateway's own auth header. */
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  /** Default "claude-opus-5-5". */
  readonly model?: string;
  /** output_config.effort. Default "low". */
  readonly effort?: "low" | "medium" | "high";
  /** "adaptive" sends thinking: { type: "adaptive" }; "off" omits the field. Default "adaptive". */
  readonly thinking?: "adaptive" | "off";
  /** Default 4000. */
  readonly maxTokens?: number;
  /** Per-request timeout of the constructed client. Default 60_000. */
  readonly timeoutMs?: number;
  /** Retries of the constructed client. Default 2. */
  readonly maxRetries?: number;
}

/** Sent as the API key when a gateway authenticates by headers and no key was given. */
const GATEWAY_PLACEHOLDER_KEY = "gateway-auth-by-headers";

const envApiKey = (): string | undefined => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.ANTHROPIC_API_KEY || undefined;
};

const textOf = (message: Anthropic.Message): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

const toMessages = (request: ModelRequest): Array<Anthropic.MessageParam> => {
  const images = request.images ?? [];
  const firstUser = request.messages.findIndex((message) => message.role === "user");
  return request.messages.map((message, index): Anthropic.MessageParam => {
    if (index !== firstUser || images.length === 0)
      return { role: message.role, content: message.content };
    return {
      role: "user",
      content: [
        ...images.map(
          (image): Anthropic.ImageBlockParam => ({
            type: "image",
            source: { type: "base64", media_type: "image/png", data: image.png },
          }),
        ),
        { type: "text", text: message.content },
      ],
    };
  });
};

/**
 * A ModelAdapter over the Anthropic Messages API: structured JSON output, adaptive thinking and a
 * cached system prompt. The client is built on the first call; with no client, apiKey, baseURL or
 * ANTHROPIC_API_KEY, complete() throws IntakeUnavailable("not_configured") without a request.
 */
export const anthropicModel = (options: AnthropicModelOptions = {}): ModelAdapter => {
  const model = options.model ?? "claude-opus-5-5";
  const effort = options.effort ?? "low";
  const thinking = options.thinking ?? "adaptive";
  const maxTokens = options.maxTokens ?? 4000;
  let client: Anthropic | undefined = options.client;

  const clientFor = (): Anthropic => {
    if (client) return client;
    const apiKey =
      options.apiKey || envApiKey() || (options.baseURL ? GATEWAY_PLACEHOLDER_KEY : undefined);
    if (!apiKey) throw new IntakeUnavailable("not_configured");
    client = new Anthropic({
      apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.defaultHeaders ? { defaultHeaders: { ...options.defaultHeaders } } : {}),
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
    });
    return client;
  };

  return {
    async complete(request) {
      const anthropic = clientFor();
      let response: Anthropic.Message;
      try {
        response = await anthropic.messages.create(
          {
            model,
            max_tokens: maxTokens,
            ...(thinking === "adaptive" ? { thinking: { type: "adaptive" } } : {}),
            output_config: {
              effort,
              // ModelRequest types the schema as `object`; the SDK wants a string-keyed record.
              format: {
                type: "json_schema",
                schema: request.outputSchema as Record<string, unknown>,
              },
            },
            system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
            messages: toMessages(request),
          },
          { signal: request.signal },
        );
      } catch (error) {
        throw new IntakeUnavailable("gateway", { cause: error });
      }
      if (response.stop_reason === "refusal") throw new IntakeUnavailable("refusal");
      return textOf(response);
    },
  };
};

import type {
  CreateReportInput,
  ElicitorTransport,
  ReportDetail,
  ReportListItem,
} from "@elicitor/core";
import { ElicitorTransportError } from "./errors.ts";

export interface FetchTransportOptions {
  /** The fetch to use. Default: the global fetch, looked up on every request. */
  readonly fetch?: typeof fetch;
  /** Extra headers (for example Authorization), or a function returning them per request. */
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Passed to fetch as is. Omitted from the request when not given. */
  readonly credentials?: RequestCredentials;
}

const errorCodeOf = (body: unknown): { code: string | null; message: string | null } => {
  if (typeof body !== "object" || body === null) return { code: null, message: null };
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return { code: null, message: null };
  const { code, message } = error as { code?: unknown; message?: unknown };
  return {
    code: typeof code === "string" ? code : null,
    message: typeof message === "string" ? message : null,
  };
};

/**
 * An ElicitorTransport over the Elicitor REST shape (see the README):
 *
 *   POST {base}/reports                 CreateReportInput  -> 201/200 ReportListItem
 *   GET  {base}/reports                                    -> ReportListItem[]
 *   GET  {base}/reports/:id                                -> ReportDetail
 *   POST {base}/reports/:id/reply       { body }           -> ReportDetail
 *   POST {base}/reports/:id/confirm     { expectedSeq }    -> ReportDetail
 *   POST {base}/reports/:id/withdraw                       -> 204
 *
 * Any non-2xx response throws ElicitorTransportError(status, code) with `code` read from a JSON
 * body `{ "error": { "code": string, "message"?: string } }` when present.
 */
export const createFetchTransport = (
  baseUrl: string,
  options: FetchTransportOptions = {},
): ElicitorTransport => {
  const base = baseUrl.replace(/\/+$/, "");
  const reportUrl = (id: string, action?: string): string =>
    `${base}/reports/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;

  const request = async (
    method: "GET" | "POST",
    url: string,
    body?: unknown,
  ): Promise<Response> => {
    const extra = typeof options.headers === "function" ? await options.headers() : options.headers;
    const headers = new Headers(extra);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const init: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(options.credentials !== undefined ? { credentials: options.credentials } : {}),
    };
    const run = options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await run(url, init);
    } catch (cause) {
      throw new ElicitorTransportError(0, "network", "Elicitor request could not be sent", {
        cause,
      });
    }
    if (response.ok) return response;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      // Not JSON: keep status only.
    }
    const { code, message } = errorCodeOf(parsed);
    throw new ElicitorTransportError(response.status, code, message ?? undefined);
  };

  const json = async <T>(response: Response): Promise<T> => {
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new ElicitorTransportError(
        response.status,
        "invalid_response",
        "Elicitor response is not JSON",
        { cause },
      );
    }
  };

  return {
    create: async (input: CreateReportInput) =>
      json<ReportListItem>(await request("POST", `${base}/reports`, input)),
    list: async () => json<ReadonlyArray<ReportListItem>>(await request("GET", `${base}/reports`)),
    get: async (id) => json<ReportDetail>(await request("GET", reportUrl(id))),
    reply: async (id, body) =>
      json<ReportDetail>(await request("POST", reportUrl(id, "reply"), { body })),
    confirm: async (id, expectedSeq) =>
      json<ReportDetail>(await request("POST", reportUrl(id, "confirm"), { expectedSeq })),
    withdraw: async (id) => {
      await request("POST", reportUrl(id, "withdraw"));
    },
  };
};

// Optional, not used by the demo: the real backend behind createFetchTransport("/api/elicitor").
// Run it with ANTHROPIC_API_KEY set and proxy /api to port 8787 from Vite. In src/App.tsx, switch the client: const transport = createFetchTransport("/api/elicitor");
import { createServer, type IncomingMessage } from "node:http";
import { anthropicModel } from "@elicitor/anthropic";
import type { CreateReportInput } from "@elicitor/core";
import { createIntake, createMemoryStore, isElicitorError } from "@elicitor/core";

const store = createMemoryStore();
const prompt = { productDescription: "an online shop" };
const intake = createIntake({ model: anthropicModel(), store, prompt });
const STATUS: Readonly<Record<string, number>> = { not_found: 404, invalid: 400, stale: 409 };
const NOT_FOUND: [number, unknown] = [404, { error: { code: "not_found" } }];
const METHOD_NOT_ALLOWED: [number, unknown] = [405, { error: { code: "method_not_allowed" } }];
// Authorisation is yours: a real server checks that the signed-in user owns the report.
const detail = (id: string): [number, unknown] => {
  const report = store.toDetail(id, { canAct: true });
  return report ? [200, report] : NOT_FOUND;
};

const json = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
};

const route = async (req: IncomingMessage): Promise<[number, unknown]> => {
  const match = /^\/api\/elicitor\/reports(?:\/([^/]+)(?:\/(\w+))?)?$/.exec(req.url ?? "");
  if (!match) return NOT_FOUND;
  const [, rawId, action] = match;
  if (rawId === undefined) {
    if (req.method === "GET") return [200, store.list()];
    if (req.method !== "POST") return METHOD_NOT_ALLOWED;
    const input = (await json(req)) as unknown as CreateReportInput;
    const screenshotPng = input.screenshotPng || null;
    const { id } = await intake.start({
      ...input,
      language: input.context.language,
      screenshotPng,
    });
    return [201, store.toListItem(id)];
  }
  const id = decodeURIComponent(rawId);
  if (action === undefined) return req.method === "GET" ? detail(id) : METHOD_NOT_ALLOWED;
  if (req.method !== "POST") return METHOD_NOT_ALLOWED;
  if (action === "reply") await intake.reply(id, String((await json(req)).body));
  else if (action === "confirm") await intake.confirm(id, Number((await json(req)).expectedSeq));
  else if (action === "withdraw") await intake.withdraw(id);
  else return NOT_FOUND;
  return action === "withdraw" ? [204, null] : detail(id);
};

createServer((req, res) => {
  const send = (status: number, payload: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(payload === null ? undefined : JSON.stringify(payload));
  };
  route(req).then(
    ([status, payload]) => send(status, payload),
    (error: unknown) => {
      const code = isElicitorError(error) ? error.code : "internal";
      send(STATUS[code] ?? 500, { error: { code } });
    },
  );
}).listen(8787);

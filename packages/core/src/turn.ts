import type { Summary, SummaryKind, Turn } from "./types.ts";

/** The agent asks at most this many questions, then must summarise. Summaries do not count. */
export const MAX_QUESTIONS = 4;

/** JSON Schema of one agent turn, for providers that support structured output. */
export const TURN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text"],
  properties: {
    kind: { type: "string", enum: ["question", "summary"] },
    text: { type: "string" },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["title", "kind", "expected", "actual", "steps", "publicSummary"],
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: ["figure", "screen", "error", "other"] },
        expected: { type: "string" },
        actual: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        publicSummary: { type: "string" },
      },
    },
  },
} as const;

const SUMMARY_KINDS: ReadonlyArray<SummaryKind> = ["figure", "screen", "error", "other"];

type Fields = Readonly<Record<string, unknown>>;
const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Decoders return a fresh object with only the known fields: excess properties are accepted and
// dropped, as a structural schema would.
const decodeSummary = (value: unknown): Summary | null => {
  if (!isFields(value)) return null;
  const { title, kind, expected, actual, steps, publicSummary } = value;
  if (
    typeof title !== "string" ||
    typeof kind !== "string" ||
    !SUMMARY_KINDS.includes(kind as SummaryKind) ||
    typeof expected !== "string" ||
    typeof actual !== "string" ||
    !Array.isArray(steps) ||
    !steps.every((step) => typeof step === "string") ||
    typeof publicSummary !== "string"
  )
    return null;
  return {
    title,
    kind: kind as SummaryKind,
    expected,
    actual,
    steps: [...(steps as ReadonlyArray<string>)],
    publicSummary,
  };
};

const decodeTurn = (value: unknown): Turn | null => {
  if (!isFields(value) || typeof value.text !== "string") return null;
  if (value.kind === "question") return { kind: "question", text: value.text };
  if (value.kind === "summary") {
    const summary = decodeSummary(value.summary);
    return summary ? { kind: "summary", text: value.text, summary } : null;
  }
  return null;
};

export const isSummary = (value: unknown): value is Summary => decodeSummary(value) !== null;

export const isTurn = (value: unknown): value is Turn => decodeTurn(value) !== null;

/**
 * Parses a model's raw text into a turn. The whole text is tried as JSON first, then the
 * outermost `{...}` (for models that wrap the JSON in prose or a code fence). Prose with no `{` at
 * all is kept as a question, for providers that ignore the output format. Anything else is null.
 */
export const parseTurn = (raw: string): Turn | null => {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  for (const candidate of [text, start >= 0 && end > start ? text.slice(start, end + 1) : null]) {
    if (candidate === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const turn = decodeTurn(parsed);
    if (turn) return turn;
  }
  return text && start < 0 ? { kind: "question", text } : null;
};

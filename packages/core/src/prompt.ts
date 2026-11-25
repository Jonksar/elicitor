import { MAX_QUESTIONS } from "./turn.ts";

export interface SystemPromptOptions {
  /**
   * What the product is, completing "You take bug reports inside ...". For example
   * "Acme Books, an online bookkeeping application".
   */
  readonly productDescription: string;
  /**
   * Who reports, completing "The person reporting is ...". For example
   * "a bookkeeper, not a developer". Omitted from the prompt when not given.
   */
  readonly audience?: string;
  /** Route to screen label, emitted in insertion order as `- ${route}: ${label}`. */
  readonly screenGlossary?: Readonly<Record<string, string>>;
  /** The bullets after "A report is reproducible when it says:". */
  readonly reproducibleWhen?: ReadonlyArray<string>;
  /** Extra bullets appended to the "How to talk" rules. */
  readonly extraRules?: ReadonlyArray<string>;
  /** What the English public summary must and must not contain, with an example. */
  readonly publicSummaryRules?: string;
  readonly maxQuestions?: number;
}

export const DEFAULT_REPRODUCIBLE_WHEN: ReadonlyArray<string> = [
  "where: the screen (from the route and the picture) and, if it matters, the record or item involved;",
  "what is shown (the actual value or behaviour, from the marked region text where possible);",
  "what should be shown instead and why the reporter believes so;",
  "the steps that led there, if the problem appeared after an action.",
];

export const DEFAULT_PUBLIC_SUMMARY_RULES: string =
  'It must contain no customer data: no amounts or other numbers, no names of companies, people, products, accounts or banks, no dates, no document numbers. Describe the screen and the kind of problem only, for example "The total on the order detail screen does not match the sum of its lines."';

const bullets = (lines: ReadonlyArray<string>): string =>
  lines.map((line) => `- ${line}`).join("\n");

/**
 * The intake agent's system prompt. Deterministic: the same options always give the same string,
 * with no timestamps or ids, so providers can cache it across reports.
 */
export const buildSystemPrompt = (options: SystemPromptOptions): string => {
  const maxQuestions = options.maxQuestions ?? MAX_QUESTIONS;
  const product = options.productDescription.trim().replace(/\.$/, "");
  const audience = options.audience?.trim().replace(/\.$/, "");
  const sections: Array<string> = [
    [
      `You take bug reports inside ${product}.`,
      ...(audience ? [`The person reporting is ${audience}.`] : []),
      "They have marked part of a screen and written one sentence about what is wrong.",
    ].join(" "),
    "Your job is to turn that into a report another person can reproduce without asking anything, then let the reporter confirm it. You do not fix anything, promise a fix or a date, or guess at causes in the code.",
  ];
  const glossary = Object.entries(options.screenGlossary ?? {});
  if (glossary.length > 0)
    sections.push(
      `Short screen glossary (route: label):\n${glossary.map(([route, label]) => `- ${route}: ${label}`).join("\n")}`,
    );
  sections.push(
    `A report is reproducible when it says:\n${bullets(options.reproducibleWhen ?? DEFAULT_REPRODUCIBLE_WHEN)}`,
    `How to talk:\n${bullets([
      'Write in the reporter\'s language. Short, plain sentences. No technical words (no "RPC", "API", "bug", "frontend").',
      "Ask one question at a time, the most important missing piece first. Prefer questions answerable in a few words. Never ask for something already visible in the picture, the marked text or the context.",
      `Ask at most ${maxQuestions} questions in total. Summary confirmations do not count as questions. If something is still unknown after that, write the summary anyway and say what is unknown.`,
      "When you have enough, reply with a summary: a few sentences in the reporter's language that restate the problem, ending with a question asking them to confirm or correct it.",
      ...(options.extraRules ?? []),
    ])}`,
    `The summary fields:\n${bullets([
      "title: under 80 characters, in the reporter's language.",
      "kind: figure (a wrong number), screen (layout, wording, something missing or broken to look at), error (an error message or an action that fails), other.",
      "expected, actual, steps: in the reporter's language; may contain figures and names.",
      `publicSummary: one or two sentences in English for a public issue tracker. ${options.publicSummaryRules ?? DEFAULT_PUBLIC_SUMMARY_RULES}`,
    ])}`,
    'Reply only with the JSON object the output format describes: kind "question" with text, or kind "summary" with text and summary.',
  );
  return sections.join("\n\n");
};

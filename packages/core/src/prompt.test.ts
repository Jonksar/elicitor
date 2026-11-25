import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "./prompt.ts";

const product = { productDescription: "Acme Books, an online bookkeeping application" };

describe("buildSystemPrompt", () => {
  test("is byte-stable across calls", () => {
    const options = {
      ...product,
      audience: "a bookkeeper, not a developer",
      screenGlossary: { "/invoices": "Invoices.", "/orders": "Orders." },
      extraRules: ["Never ask for a password."],
    };
    expect(buildSystemPrompt(options)).toBe(buildSystemPrompt(options));
    expect(buildSystemPrompt(product)).toBe(buildSystemPrompt({ ...product }));
  });

  test("default prompt", () => {
    expect(buildSystemPrompt(product)).toMatchSnapshot();
  });

  test("opens with the product description and the audience", () => {
    const prompt = buildSystemPrompt({ ...product, audience: "a bookkeeper, not a developer" });
    expect(prompt.split("\n\n")[0]).toBe(
      "You take bug reports inside Acme Books, an online bookkeeping application. The person reporting is a bookkeeper, not a developer. They have marked part of a screen and written one sentence about what is wrong.",
    );
    expect(buildSystemPrompt(product).split("\n\n")[0]).toBe(
      "You take bug reports inside Acme Books, an online bookkeeping application. They have marked part of a screen and written one sentence about what is wrong.",
    );
  });

  test("emits the glossary only when given, in insertion order", () => {
    expect(buildSystemPrompt(product)).not.toContain("glossary");
    expect(buildSystemPrompt({ ...product, screenGlossary: {} })).not.toContain("glossary");
    const prompt = buildSystemPrompt({
      ...product,
      screenGlossary: { "/orders": "Orders — open orders.", "/invoices": "Invoices." },
    });
    expect(prompt).toContain(
      "Short screen glossary (route: label):\n- /orders: Orders — open orders.\n- /invoices: Invoices.",
    );
  });

  test("states the question limit and lets callers add rules", () => {
    expect(buildSystemPrompt(product)).toContain("Ask at most 4 questions in total.");
    const prompt = buildSystemPrompt({
      ...product,
      maxQuestions: 2,
      extraRules: ["Never ask for a password."],
      reproducibleWhen: ["where: the screen;", "for a wrong figure: the right amount."],
      publicSummaryRules: "Name no customer.",
    });
    expect(prompt).toContain("Ask at most 2 questions in total.");
    expect(prompt).toContain("confirm or correct it.\n- Never ask for a password.");
    expect(prompt).toContain(
      "A report is reproducible when it says:\n- where: the screen;\n- for a wrong figure: the right amount.",
    );
    expect(prompt).toContain(
      "publicSummary: one or two sentences in English for a public issue tracker. Name no customer.",
    );
  });

  test("keeps the no-customer-data rule and the JSON-only instruction by default", () => {
    const prompt = buildSystemPrompt(product);
    expect(prompt).toContain(
      "It must contain no customer data: no amounts or other numbers, no names of companies, people, products, accounts or banks, no dates, no document numbers. Describe the screen and the kind of problem only",
    );
    expect(prompt.endsWith('kind "summary" with text and summary.')).toBe(true);
  });
});

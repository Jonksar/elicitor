import type { ElicitorProviderProps } from "@elicitor/react";
import { describe, expect, it } from "vitest";
import {
  bundles,
  formatMessage,
  type Locale,
  type MessageOverrides,
  type Messages,
  normalizeLocale,
  resolveMessages,
} from "./i18n.ts";

const locales = Object.keys(bundles) as Locale[];

describe("bundles", () => {
  it("ships en, et, fi and ru with identical key sets and no empty values", () => {
    expect(locales.sort()).toEqual(["en", "et", "fi", "ru"]);
    const keys = Object.keys(bundles.en).sort();
    for (const locale of locales) {
      expect(Object.keys(bundles[locale]).sort(), locale).toEqual(keys);
      for (const [key, value] of Object.entries(bundles[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("keeps the same placeholders in every language", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const key of Object.keys(bundles.en) as (keyof typeof bundles.en)[]) {
      for (const locale of locales) {
        expect(placeholders(bundles[locale][key]), `${locale}.${key}`).toEqual(
          placeholders(bundles.en[key]),
        );
      }
    }
  });

  it("keeps the established Estonian wording", () => {
    expect(bundles.et.sentence).toBe("Mis on valesti?");
    expect(bundles.et.whole).toBe("Terve vaade");
    expect(bundles.et.list).toBe("Minu veateated");
    expect(bundles.et.submitted).toBe("Saadetud");
    expect(bundles.et.confirm).toBe("Õige, saada edasi");
  });
});

describe("normalizeLocale", () => {
  it.each([
    ["et-EE", "et"],
    ["fi_FI", "fi"],
    ["RU", "ru"],
    ["en-GB", "en"],
    ["de", "en"],
    ["", "en"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });
});

describe("resolveMessages", () => {
  it("replaces single keys and ignores unknown keys and empty values", () => {
    const messages = resolveMessages("et-EE", { report: "Leidsid vea?", nope: "x", send: "" });
    expect(messages.report).toBe("Leidsid vea?");
    expect(messages.send).toBe("Saada");
    expect("nope" in messages).toBe(false);
  });

  it("falls back to English for an unknown locale", () => {
    expect(resolveMessages("xx").send).toBe("Send");
  });

  // Compile-time check (pnpm typecheck): every shape a host types its texts with is accepted by
  // the provider's `messages` prop without a cast.
  it("accepts a full bundle, a partial one and a plain record as the provider's messages", () => {
    const full: Messages = { ...bundles.en, report: "Send feedback" };
    const partial: Partial<Messages> = { list: "My feedback" };
    const overrides: MessageOverrides = { send: "Go" };
    const plain: Record<string, string> = { close: "Done" };
    const accepted: Array<NonNullable<ElicitorProviderProps["messages"]>> = [
      full,
      partial,
      overrides,
      plain,
    ];
    expect(accepted.map((messages) => resolveMessages("en", messages))).toMatchObject([
      { report: "Send feedback" },
      { list: "My feedback" },
      { send: "Go" },
      { close: "Done" },
    ]);
  });
});

describe("formatMessage", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(formatMessage("Report #{number} {other}", { number: 7 })).toBe("Report #7 {other}");
  });
});

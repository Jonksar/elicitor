import type { ReportStatus, SummaryKind } from "@elicitor/core";
import { type RegionSelectLabels, useElicitor } from "@elicitor/react";
import { useMemo } from "react";
import {
  formatMessage,
  kindKey,
  type Locale,
  type MessageKey,
  type Messages,
  normalizeLocale,
  resolveMessages,
} from "./i18n.ts";

export interface MessagesApi {
  /** The bundle in use: "en", "et", "fi" or "ru". */
  readonly locale: Locale;
  /** The resolved texts (bundle plus the provider's `messages` overrides). */
  readonly messages: Messages;
  /** A text by key, with "{name}" placeholders filled from `values`. */
  t(key: MessageKey, values?: Readonly<Record<string, string | number>>): string;
  status(status: ReportStatus): string;
  kind(kind: SummaryKind): string;
  /** A date in the provider's locale (Intl.DateTimeFormat, medium date style). */
  date(iso: string): string;
  /** Texts for the region-select overlay, for `useElicitor().open({ labels })`. */
  readonly overlayLabels: RegionSelectLabels;
}

const dateFormat = (locale: string): Intl.DateTimeFormat => {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  } catch {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium" });
  }
};

/** The widget's texts for the provider's `locale` and `messages`. Must be used inside the provider. */
export const useMessages = (): MessagesApi => {
  const { locale, messages: overrides } = useElicitor();
  return useMemo<MessagesApi>(() => {
    const messages = resolveMessages(locale, overrides);
    const format = dateFormat(locale);
    const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string =>
      values ? formatMessage(messages[key], values) : messages[key];
    return {
      locale: normalizeLocale(locale),
      messages,
      t,
      status: (status) => messages[status],
      kind: (kind) => messages[kindKey(kind)],
      date: (iso) => {
        const value = new Date(iso);
        return Number.isNaN(value.getTime()) ? iso : format.format(value);
      },
      overlayLabels: { hint: messages.mark, wholeView: messages.whole, cancel: messages.cancel },
    };
  }, [locale, overrides]);
};

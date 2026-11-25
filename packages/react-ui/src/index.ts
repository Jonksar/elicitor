// Styles ship separately: import "@elicitor/react-ui/styles.css" once in your app.

// Everything of @elicitor/react (provider, hooks, transports, errors, wire types), so a host or a
// custom transport needs only this package.
export * from "@elicitor/react";
export {
  Elicitor,
  type ElicitorPosition,
  type ElicitorProps,
  type TriggerApi,
} from "./elicitor.tsx";
export {
  bundles,
  formatMessage,
  type Locale,
  type MessageKey,
  type MessageOverrides,
  type Messages,
  normalizeLocale,
  resolveMessages,
} from "./i18n.ts";
export type { ColorScheme } from "./parts.tsx";
export { ReportList, type ReportListProps, type ReportRowState } from "./report-list.tsx";
export {
  type RenderError,
  ReportThread,
  type ReportThreadProps,
  SummaryConfirm,
  type SummaryConfirmProps,
} from "./report-thread.tsx";
export { type MessagesApi, useMessages } from "./use-messages.ts";

import type { SummaryKind } from "@elicitor/core";

/**
 * Every UI text of the widget. The four bundles below have exactly these keys. A type alias (not
 * an interface) so a full bundle is also a plain string record, as the provider's `messages` takes.
 */
export type Messages = {
  /** Trigger button and its accessible name. */
  readonly report: string;
  /** Title of the reporter's own report list. */
  readonly list: string;
  /** Region-select overlay: the hint. */
  readonly mark: string;
  /** Region-select overlay: the whole-view button. */
  readonly whole: string;
  readonly cancel: string;
  readonly close: string;
  readonly send: string;
  readonly sending: string;
  /** Title of the compose dialog and label of its text field. */
  readonly sentence: string;
  readonly sentenceHint: string;
  /** Creating the report failed. */
  readonly failed: string;
  readonly captureFailed: string;
  /** Alt text of the compose dialog's screenshot. */
  readonly screenshot: string;
  /** Alt text of the screenshot in `<ReportThread showScreenshot />`. */
  readonly reportScreenshot: string;
  readonly empty: string;
  readonly loading: string;
  readonly loadFailed: string;
  readonly loadReportFailed: string;
  readonly notFound: string;
  readonly retry: string;
  readonly withdraw: string;
  readonly withdrawFailed: string;
  readonly status: string;
  readonly unread: string;
  /** "{number}" is the report's number. */
  readonly reportNumber: string;
  readonly intake: string;
  readonly submitted: string;
  readonly in_progress: string;
  readonly needs_reply: string;
  readonly fixed: string;
  readonly closed: string;
  readonly withdrawn: string;
  readonly reporter: string;
  readonly otherReporter: string;
  readonly agent: string;
  readonly fixer: string;
  readonly system: string;
  readonly summaryTitle: string;
  readonly kind: string;
  readonly kind_figure: string;
  readonly kind_screen: string;
  readonly kind_error: string;
  readonly kind_other: string;
  readonly actual: string;
  readonly expected: string;
  readonly steps: string;
  readonly confirm: string;
  readonly confirmFailed: string;
  readonly stale: string;
  readonly answer: string;
  /** Label of the reply field while a summary waits for confirmation. */
  readonly correct: string;
  readonly correctHint: string;
  readonly reply: string;
  readonly thinking: string;
  readonly replyFailed: string;
  readonly sentTitle: string;
  /** "{list}" is the list title. */
  readonly sentBody: string;
};

export type MessageKey = keyof Messages;
export type Locale = "en" | "et" | "fi" | "ru";
export type MessageOverrides = Readonly<Partial<Record<MessageKey, string>>>;

const en: Messages = {
  report: "Report a problem",
  list: "My bug reports",
  mark: "Mark the problem. Drag a rectangle or press Enter to select the whole screen.",
  whole: "Whole screen",
  cancel: "Cancel",
  close: "Close",
  send: "Send",
  sending: "Sending…",
  sentence: "What is wrong?",
  sentenceHint: "One sentence is enough. The assistant will ask if it needs more.",
  failed: "Could not save the bug report. Try again.",
  captureFailed: "Could not capture the screen. Try again.",
  screenshot: "Bug report screenshot",
  reportScreenshot: "Screenshot of the report",
  empty: "You have no bug reports yet.",
  loading: "Loading…",
  loadFailed: "Could not load bug reports.",
  loadReportFailed: "Could not load the bug report.",
  notFound: "Bug report not found.",
  retry: "Try again",
  withdraw: "Withdraw report",
  withdrawFailed: "Could not withdraw the report. Try again.",
  status: "Status",
  unread: "New",
  reportNumber: "Report #{number}",
  intake: "Clarifying",
  submitted: "Submitted",
  in_progress: "Being fixed",
  needs_reply: "Needs your reply",
  fixed: "Fixed",
  closed: "Closed",
  withdrawn: "Withdrawn",
  reporter: "You",
  otherReporter: "Reporter",
  agent: "Assistant",
  fixer: "Developer",
  system: "System",
  summaryTitle: "Is this right?",
  kind: "Type",
  kind_figure: "Wrong figure",
  kind_screen: "Screen or layout",
  kind_error: "Error",
  kind_other: "Other",
  actual: "Shown now",
  expected: "Should be",
  steps: "Steps",
  confirm: "Correct, send it on",
  confirmFailed: "Could not confirm the summary. Try again.",
  stale: "The summary has changed. Check the latest version.",
  answer: "Your answer",
  correct: "Correct or add detail",
  correctHint: "Not quite right? Write what to change and the assistant will update the summary.",
  reply: "Reply",
  thinking: "The assistant is thinking…",
  replyFailed: "Could not send the reply. Try again.",
  sentTitle: "Thank you, the report has been sent.",
  sentBody: "You can follow it under “{list}”.",
};

const et: Messages = {
  report: "Teata veast",
  list: "Minu veateated",
  mark: "Märgi probleemne koht. Lohista ristkülik või vajuta Enter, et valida terve vaade.",
  whole: "Terve vaade",
  cancel: "Tühista",
  close: "Sulge",
  send: "Saada",
  sending: "Saadan…",
  sentence: "Mis on valesti?",
  sentenceHint: "Piisab ühest lausest. Assistent küsib, kui vajab rohkem infot.",
  failed: "Veateate salvestamine ebaõnnestus. Proovi uuesti.",
  captureFailed: "Kuvatõmmise loomine ebaõnnestus. Proovi uuesti.",
  screenshot: "Veateate kuvatõmmis",
  reportScreenshot: "Veateate kuvatõmmis",
  empty: "Sul ei ole veel veateateid.",
  loading: "Laadin…",
  loadFailed: "Veateadete laadimine ebaõnnestus.",
  loadReportFailed: "Veateate laadimine ebaõnnestus.",
  notFound: "Veateadet ei leitud.",
  retry: "Proovi uuesti",
  withdraw: "Võta veateade tagasi",
  withdrawFailed: "Veateate tagasivõtmine ebaõnnestus. Proovi uuesti.",
  status: "Olek",
  unread: "Uus",
  reportNumber: "Veateade #{number}",
  intake: "Täpsustamisel",
  submitted: "Saadetud",
  in_progress: "Parandamisel",
  needs_reply: "Ootab vastust",
  fixed: "Parandatud",
  closed: "Suletud",
  withdrawn: "Tagasi võetud",
  reporter: "Sina",
  otherReporter: "Teataja",
  agent: "Assistent",
  fixer: "Arendaja",
  system: "Süsteem",
  summaryTitle: "Kas see on õige?",
  kind: "Liik",
  kind_figure: "Vale arv",
  kind_screen: "Vaade või paigutus",
  kind_error: "Tõrge",
  kind_other: "Muu",
  actual: "Praegu on",
  expected: "Peaks olema",
  steps: "Sammud",
  confirm: "Õige, saada edasi",
  confirmFailed: "Kokkuvõtte kinnitamine ebaõnnestus. Proovi uuesti.",
  stale: "Kokkuvõte on muutunud. Vaata uusimat versiooni.",
  answer: "Sinu vastus",
  correct: "Paranda või täpsusta",
  correctHint: "Pole päris õige? Kirjuta, mida muuta, ja assistent uuendab kokkuvõtet.",
  reply: "Vasta",
  thinking: "Assistent mõtleb…",
  replyFailed: "Vastuse saatmine ebaõnnestus. Proovi uuesti.",
  sentTitle: "Aitäh! Veateade on saadetud.",
  sentBody: "Selle käiku saad jälgida vaates „{list}“.",
};

const fi: Messages = {
  report: "Ilmoita ongelmasta",
  list: "Omat vikailmoitukset",
  mark: "Merkitse ongelmakohta. Vedä suorakulmio tai valitse koko näkymä painamalla Enter.",
  whole: "Koko näkymä",
  cancel: "Peruuta",
  close: "Sulje",
  send: "Lähetä",
  sending: "Lähetetään…",
  sentence: "Mikä on vialla?",
  sentenceHint: "Yksi lause riittää. Avustaja kysyy, jos se tarvitsee lisätietoja.",
  failed: "Vikailmoituksen tallentaminen epäonnistui. Yritä uudelleen.",
  captureFailed: "Näytön kaappaaminen epäonnistui. Yritä uudelleen.",
  screenshot: "Vikailmoituksen kuvakaappaus",
  reportScreenshot: "Ilmoituksen kuvakaappaus",
  empty: "Sinulla ei ole vielä vikailmoituksia.",
  loading: "Ladataan…",
  loadFailed: "Vikailmoitusten lataaminen epäonnistui.",
  loadReportFailed: "Vikailmoituksen lataaminen epäonnistui.",
  notFound: "Vikailmoitusta ei löytynyt.",
  retry: "Yritä uudelleen",
  withdraw: "Peru vikailmoitus",
  withdrawFailed: "Vikailmoituksen peruminen epäonnistui. Yritä uudelleen.",
  status: "Tila",
  unread: "Uusi",
  reportNumber: "Vikailmoitus #{number}",
  intake: "Tarkennetaan",
  submitted: "Lähetetty",
  in_progress: "Korjataan",
  needs_reply: "Odottaa vastaustasi",
  fixed: "Korjattu",
  closed: "Suljettu",
  withdrawn: "Peruttu",
  reporter: "Sinä",
  otherReporter: "Ilmoittaja",
  agent: "Avustaja",
  fixer: "Kehittäjä",
  system: "Järjestelmä",
  summaryTitle: "Onko tämä oikein?",
  kind: "Tyyppi",
  kind_figure: "Väärä luku",
  kind_screen: "Näkymä tai asettelu",
  kind_error: "Virhe",
  kind_other: "Muu",
  actual: "Nyt näkyy",
  expected: "Pitäisi olla",
  steps: "Vaiheet",
  confirm: "Oikein, lähetä eteenpäin",
  confirmFailed: "Yhteenvedon vahvistaminen epäonnistui. Yritä uudelleen.",
  stale: "Yhteenveto on muuttunut. Tarkista uusin versio.",
  answer: "Vastauksesi",
  correct: "Korjaa tai tarkenna",
  correctHint:
    "Eikö aivan oikein? Kirjoita, mitä pitää muuttaa, niin avustaja päivittää yhteenvedon.",
  reply: "Vastaa",
  thinking: "Avustaja miettii…",
  replyFailed: "Vastauksen lähettäminen epäonnistui. Yritä uudelleen.",
  sentTitle: "Kiitos, vikailmoitus on lähetetty.",
  sentBody: "Voit seurata sitä kohdassa ”{list}”.",
};

const ru: Messages = {
  report: "Сообщить о проблеме",
  list: "Мои сообщения об ошибках",
  mark: "Отметьте проблемное место. Выделите прямоугольник или нажмите Enter, чтобы выбрать весь экран.",
  whole: "Весь экран",
  cancel: "Отмена",
  close: "Закрыть",
  send: "Отправить",
  sending: "Отправка…",
  sentence: "Что не так?",
  sentenceHint: "Достаточно одного предложения. Ассистент уточнит, если понадобится.",
  failed: "Не удалось сохранить сообщение об ошибке. Попробуйте ещё раз.",
  captureFailed: "Не удалось сделать снимок экрана. Попробуйте ещё раз.",
  screenshot: "Снимок экрана к сообщению об ошибке",
  reportScreenshot: "Снимок экрана из сообщения",
  empty: "У вас пока нет сообщений об ошибках.",
  loading: "Загрузка…",
  loadFailed: "Не удалось загрузить сообщения об ошибках.",
  loadReportFailed: "Не удалось загрузить сообщение об ошибке.",
  notFound: "Сообщение об ошибке не найдено.",
  retry: "Попробовать ещё раз",
  withdraw: "Отозвать сообщение",
  withdrawFailed: "Не удалось отозвать сообщение. Попробуйте ещё раз.",
  status: "Статус",
  unread: "Новое",
  reportNumber: "Сообщение №{number}",
  intake: "Уточняется",
  submitted: "Отправлено",
  in_progress: "Исправляется",
  needs_reply: "Ждёт вашего ответа",
  fixed: "Исправлено",
  closed: "Закрыто",
  withdrawn: "Отозвано",
  reporter: "Вы",
  otherReporter: "Автор",
  agent: "Ассистент",
  fixer: "Разработчик",
  system: "Система",
  summaryTitle: "Всё верно?",
  kind: "Тип",
  kind_figure: "Неверное число",
  kind_screen: "Экран или макет",
  kind_error: "Ошибка",
  kind_other: "Другое",
  actual: "Сейчас показано",
  expected: "Должно быть",
  steps: "Шаги",
  confirm: "Верно, отправить дальше",
  confirmFailed: "Не удалось подтвердить итог. Попробуйте ещё раз.",
  stale: "Итог изменился. Проверьте последнюю версию.",
  answer: "Ваш ответ",
  correct: "Исправить или уточнить",
  correctHint: "Не совсем так? Напишите, что изменить, и ассистент обновит итог.",
  reply: "Ответить",
  thinking: "Ассистент думает…",
  replyFailed: "Не удалось отправить ответ. Попробуйте ещё раз.",
  sentTitle: "Спасибо, сообщение отправлено.",
  sentBody: "Следить за ним можно в разделе «{list}».",
};

/** The built-in message bundles by locale. */
export const bundles: Readonly<Record<Locale, Messages>> = { en, et, fi, ru };

/** "et-EE" → "et"; anything without a bundle → "en". */
export const normalizeLocale = (locale: string): Locale => {
  const language = locale.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return language in bundles ? (language as Locale) : "en";
};

/**
 * The locale's bundle with the overrides applied per key. Unknown keys and empty values in the
 * overrides are ignored.
 */
export const resolveMessages = (
  locale: string,
  overrides: Readonly<Record<string, string | undefined>> = {},
): Messages => {
  const base = bundles[normalizeLocale(locale)];
  const result: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in base && typeof value === "string" && value !== "") result[key] = value;
  }
  return result as unknown as Messages;
};

/** Replaces "{name}" placeholders; unknown names stay as written. */
export const formatMessage = (
  template: string,
  values: Readonly<Record<string, string | number>> = {},
): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );

/** The label key for a summary kind. */
export const kindKey = (kind: SummaryKind): MessageKey => `kind_${kind}`;

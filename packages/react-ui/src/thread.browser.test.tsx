import "./styles.css";
import type { ReportDetail } from "@elicitor/core";
import { ElicitorTransportError } from "@elicitor/react";
import { createMemoryTransport, type MemoryTransport } from "@elicitor/react/testing";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Elicitor } from "./elicitor.tsx";
import { ReportList } from "./report-list.tsx";
import { ReportThread, SummaryConfirm } from "./report-thread.tsx";
import { CONTEXT, createReport, type Deferred, deferred, TestProvider } from "./test-helpers.tsx";

/** A valid 1×1 PNG. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** A report with the assistant's summary pending (sentence, question, answer, summary). */
const reportWithSummary = async (transport: MemoryTransport, sentence = "Wrong figure") => {
  const { id } = await createReport(transport, sentence);
  await transport.reply(id, "Two");
  return id;
};

describe("ownership", () => {
  it("labels the reporter's messages from viewerIsReporter and hides a non-owner's controls", async () => {
    const transport = createMemoryTransport();
    const id = await reportWithSummary(transport);

    // Positive control: the owner sees every control.
    const owner = await render(
      <TestProvider transport={transport}>
        <ReportThread reportId={id} />
      </TestProvider>,
    );
    await expect.element(page.getByRole("button", { name: "Correct, send it on" })).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Correct or add detail" }))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Reply" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Withdraw report" })).toBeVisible();
    await expect.element(page.getByText("You", { exact: true }).first()).toBeVisible();
    await owner.unmount();

    transport.actAs(false);
    await render(
      <TestProvider transport={transport}>
        <ReportThread reportId={id} />
      </TestProvider>,
    );
    await expect.element(page.getByText("What should be shown there instead?")).toBeVisible();
    await expect.element(page.getByText("Clarifying", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Reporter", { exact: true }).first()).toBeVisible();
    // The summary is still read back, without its actions.
    await expect.element(page.getByRole("region", { name: "Wrong figure" })).toBeVisible();
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Correct, send it on" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Correct or add detail" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Reply" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Withdraw report" }).elements()).toHaveLength(0);
  });
});

describe("<SummaryConfirm />", () => {
  it("offers confirm and correct only while pending and allowed", async () => {
    const transport = createMemoryTransport();
    const report = await transport.get(await reportWithSummary(transport));
    const onConfirm = vi.fn();
    const onCorrect = vi.fn();
    const screen = await render(
      <TestProvider transport={transport} locale="ru">
        <SummaryConfirm report={report} onConfirm={onConfirm} onCorrect={onCorrect} />
      </TestProvider>,
    );
    await expect.element(page.getByText("Всё верно?", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Должно быть")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Верно, отправить дальше" }));
    await userEvent.click(page.getByRole("button", { name: "Исправить или уточнить" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCorrect).toHaveBeenCalledTimes(1);

    const viewer = { ...report, canConfirm: false, canReply: false };
    await screen.rerender(
      <TestProvider transport={transport} locale="ru">
        <SummaryConfirm report={viewer} onConfirm={onConfirm} onCorrect={onCorrect} />
      </TestProvider>,
    );
    await expect.element(page.getByText("Должно быть")).toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(0);
  });
});

describe("forced scheme", () => {
  it("draws the summary card in the thread's forced scheme", async () => {
    const transport = createMemoryTransport();
    const id = await reportWithSummary(transport);
    await render(
      <TestProvider transport={transport}>
        <ReportThread reportId={id} colorScheme="dark" />
      </TestProvider>,
    );
    const card = page.getByRole("region", { name: "Wrong figure" });
    await expect.element(card).toBeVisible();
    expect(card.element().getAttribute("data-elicitor-scheme")).toBe("dark");
    // Dark --_bg (#1c1c21), whatever the browser's own scheme is.
    expect(getComputedStyle(card.element()).backgroundColor).toBe("rgb(28, 28, 33)");
  });
});

describe("thread states", () => {
  it("shows not found for a missing report", async () => {
    await render(
      <TestProvider transport={createMemoryTransport()}>
        <ReportThread reportId="missing" />
      </TestProvider>,
    );
    await expect.element(page.getByRole("alert")).toHaveTextContent("Bug report not found.");
  });

  it("shows a load error with retry", async () => {
    const transport = createMemoryTransport();
    const { id } = await createReport(transport, "Wrong figure");
    vi.spyOn(transport, "get").mockRejectedValueOnce(new Error("offline"));
    await render(
      <TestProvider transport={transport}>
        <ReportThread reportId={id} />
      </TestProvider>,
    );
    const alert = page.getByRole("alert");
    await expect.element(alert.getByText("Could not load the bug report.")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Try again" }));
    await expect.element(page.getByRole("heading", { name: "Wrong figure" })).toBeVisible();
  });

  it("keeps the reply text and shows an error when the reply fails", async () => {
    const transport = createMemoryTransport();
    const { id } = await createReport(transport, "Wrong figure");
    vi.spyOn(transport, "reply").mockRejectedValueOnce(new Error("offline"));
    await render(
      <TestProvider transport={transport}>
        <ReportThread reportId={id} />
      </TestProvider>,
    );
    await userEvent.fill(page.getByRole("textbox", { name: "Your answer" }), "Two");
    await userEvent.click(page.getByRole("button", { name: "Reply" }));
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Could not send the reply. Try again.");
    await expect.element(page.getByRole("textbox", { name: "Your answer" })).toHaveValue("Two");
  });

  it("shows the report number, date and a log region", async () => {
    const transport = createMemoryTransport();
    const { id } = await createReport(transport, "Wrong figure");
    await render(
      <TestProvider transport={transport} locale="et">
        <ReportThread reportId={id} />
      </TestProvider>,
    );
    await expect.element(page.getByText("Veateade #1")).toBeVisible();
    const log = page.getByRole("log");
    await expect.element(log).toHaveAttribute("aria-live", "polite");
    await expect.element(log.getByText("Wrong figure")).toBeVisible();
    await expect.element(log.getByText("Assistent", { exact: true })).toBeVisible();
  });

  it("drops its heading but keeps an accessible name when the host has its own", async () => {
    const transport = createMemoryTransport();
    await createReport(transport, "Wrong total");
    await render(
      <TestProvider transport={transport} locale="en">
        <ReportList showTitle={false} />
      </TestProvider>,
    );
    await expect.element(page.getByText("Wrong total")).toBeVisible();
    expect(document.querySelector(".el-section-title")).toBeNull();
    expect(document.querySelector("ul.el-list")?.getAttribute("aria-label")).toBeTruthy();
  });

  it("lists reports with a status label and date, and an empty state", async () => {
    const transport = createMemoryTransport();
    const first = await render(
      <TestProvider transport={transport} locale="fi">
        <ReportList />
      </TestProvider>,
    );
    await expect.element(page.getByText("Sinulla ei ole vielä vikailmoituksia.")).toBeVisible();
    await first.unmount();
    const { createdAt } = await createReport(transport, "Väärä summa");
    await render(
      <TestProvider transport={transport} locale="fi">
        <ReportList />
      </TestProvider>,
    );
    await expect.element(page.getByText("Väärä summa")).toBeVisible();
    await expect.element(page.getByText("Tarkennetaan", { exact: true })).toBeVisible();
    const date = new Intl.DateTimeFormat("fi", { dateStyle: "medium" }).format(new Date(createdAt));
    await expect.element(page.getByText(date)).toBeVisible();
    // Rows are not interactive without onSelect.
    expect(page.getByRole("button").elements()).toHaveLength(0);
  });
});

// Ported from the original widget's report page tests: a slow reply or confirm must not bring back
// the state from before a withdraw, nor replace a report selected meanwhile.
describe("ported report tests", () => {
  const deferTransport = (transport: MemoryTransport) => {
    const pending: Deferred<ReportDetail>[] = [];
    const hold = () => {
      const next = deferred<ReportDetail>();
      pending.push(next);
      return next.promise;
    };
    const reply = vi.spyOn(transport, "reply").mockImplementationOnce(hold);
    const confirm = vi.spyOn(transport, "confirm").mockImplementationOnce(hold);
    return { pending, reply, confirm };
  };

  it.each(["reply", "confirm"] as const)(
    "keeps the withdrawn report visible after a delayed %s completes",
    async (operation) => {
      const transport = createMemoryTransport();
      const id =
        operation === "reply"
          ? (await createReport(transport, "Wrong figure")).id
          : await reportWithSummary(transport);
      const initial = await transport.get(id);
      const held = deferTransport(transport);
      await render(
        <TestProvider transport={transport}>
          <ReportThread reportId={id} />
        </TestProvider>,
      );
      if (operation === "reply") {
        await userEvent.fill(page.getByRole("textbox"), "Two");
        await userEvent.click(page.getByRole("button", { name: "Reply", exact: true }));
        expect(held.reply).toHaveBeenCalledWith(id, "Two");
      } else {
        await userEvent.click(
          page.getByRole("button", { name: "Correct, send it on", exact: true }),
        );
        expect(held.confirm).toHaveBeenCalledWith(id, 4);
      }
      await userEvent.click(page.getByRole("button", { name: "Withdraw report", exact: true }));
      await expect.element(page.getByText("Withdrawn", { exact: true })).toBeVisible();
      held.pending[0]?.resolve({
        ...initial,
        status: operation === "confirm" ? "submitted" : "intake",
      });
      await held.pending[0]?.promise;
      await expect.element(page.getByText("Withdrawn", { exact: true })).toBeVisible();
      await expect.element(page.getByText("Loading…", { exact: true })).not.toBeInTheDocument();
    },
  );

  it("keeps a newly selected report visible after the old reply completes", async () => {
    const transport = createMemoryTransport();
    const first = await createReport(transport, "Wrong figure");
    const second = await createReport(transport, "Another report");
    await transport.withdraw(second.id);
    const initial = await transport.get(first.id);
    const held = deferTransport(transport);
    const screen = await render(
      <TestProvider transport={transport}>
        <ReportThread reportId={first.id} />
      </TestProvider>,
    );
    await userEvent.fill(page.getByRole("textbox"), "Two");
    await userEvent.click(page.getByRole("button", { name: "Reply", exact: true }));
    await screen.rerender(
      <TestProvider transport={transport}>
        <ReportThread reportId={second.id} />
      </TestProvider>,
    );
    await expect
      .element(page.getByRole("heading", { name: "Another report", exact: true }))
      .toBeVisible();
    held.pending[0]?.resolve(initial);
    await held.pending[0]?.promise;
    await expect
      .element(page.getByRole("heading", { name: "Another report", exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Loading…", { exact: true })).not.toBeInTheDocument();
  });
});

// Ported from the original widget's compose dialog test.
it("sends a trimmed sentence and keeps the screenshot visible when submission fails", async () => {
  const transport = createMemoryTransport();
  const create = vi.spyOn(transport, "create").mockRejectedValueOnce(new Error("offline"));
  await render(
    <TestProvider transport={transport} locale="et" screenshot>
      <Elicitor />
    </TestProvider>,
  );
  await userEvent.click(page.getByRole("button", { name: "Teata veast" }));
  await userEvent.click(page.getByRole("button", { name: "Terve vaade" }));
  const dialog = page.getByRole("dialog", { name: "Mis on valesti?" });
  await userEvent.fill(dialog.getByRole("textbox"), "  Vale summa  ");
  await userEvent.click(dialog.getByRole("button", { name: "Saada" }));
  await expect
    .element(dialog.getByRole("alert"))
    .toHaveTextContent("Veateate salvestamine ebaõnnestus. Proovi uuesti.");
  expect(create.mock.calls[0]?.[0].sentence).toBe("Vale summa");
  await expect.element(dialog.getByRole("textbox")).toHaveValue("  Vale summa  ");
  await expect.element(dialog.getByRole("img", { name: "Veateate kuvatõmmis" })).toBeVisible();
});

describe("report page options", () => {
  const withScreenshot = async (transport: MemoryTransport) =>
    (
      await transport.create({
        sentence: "Wrong figure",
        route: "/",
        regionText: [],
        context: CONTEXT,
        screenshotPng: PNG,
      })
    ).id;

  it("shows the screenshot only with showScreenshot, with a localised alt text", async () => {
    const transport = createMemoryTransport();
    const id = await withScreenshot(transport);
    const plain = await render(
      <TestProvider transport={transport} locale="et">
        <ReportThread reportId={id} />
      </TestProvider>,
    );
    await expect.element(page.getByRole("heading", { name: "Wrong figure" })).toBeVisible();
    expect(page.getByRole("img").elements()).toHaveLength(0);
    await plain.unmount();
    await render(
      <TestProvider transport={transport} locale="et">
        <ReportThread reportId={id} showScreenshot />
      </TestProvider>,
    );
    const image = page.getByRole("img", { name: "Veateate kuvatõmmis", exact: true });
    await expect.element(image).toBeVisible();
    expect(image.element().getAttribute("src")).toBe(`data:image/png;base64,${PNG}`);
  });

  it("renders a header node at once and a header function with the loaded report", async () => {
    const transport = createMemoryTransport();
    const { id } = await createReport(transport, "Wrong figure");
    const held = deferred<ReportDetail>();
    const get = vi.spyOn(transport, "get").mockImplementationOnce(() => held.promise);
    const screen = await render(
      <TestProvider transport={transport}>
        <ReportThread reportId={id} header={<a href="/reports">All reports</a>} />
      </TestProvider>,
    );
    await expect.element(page.getByRole("link", { name: "All reports" })).toBeVisible();
    held.resolve(await transport.get(id));
    get.mockRestore();
    await screen.rerender(
      <TestProvider transport={transport}>
        <ReportThread reportId={id} header={(report) => <p>Filed at {report.route}</p>} />
      </TestProvider>,
    );
    await expect.element(page.getByText("Filed at /")).toBeVisible();
  });

  it("shows the pending summary card when the host left out its message", async () => {
    const transport = createMemoryTransport();
    const id = await reportWithSummary(transport);
    const full = await transport.get(id);
    vi.spyOn(transport, "get").mockResolvedValue({
      ...full,
      messages: full.messages.filter((message) => message.seq !== full.pendingSummarySeq),
    });
    await render(
      <TestProvider transport={transport}>
        <ReportThread reportId={id} />
      </TestProvider>,
    );
    const card = page.getByRole("region", { name: "Wrong figure" });
    await expect.element(card).toBeVisible();
    await userEvent.click(card.getByRole("button", { name: "Correct, send it on" }));
    await expect.element(page.getByText("Submitted", { exact: true })).toBeVisible();
  });

  it("lets the host render its own load error and falls back to the default", async () => {
    const transport = createMemoryTransport();
    const { id } = await createReport(transport, "Wrong figure");
    vi.spyOn(transport, "get")
      .mockRejectedValueOnce(new ElicitorTransportError(503, "unavailable"))
      .mockRejectedValueOnce(new Error("offline"));
    const renderError = (error: unknown, retry: () => void) =>
      error instanceof ElicitorTransportError && error.code === "unavailable" ? (
        <p role="alert">
          <span>Reports are down.</span>
          <button type="button" onClick={retry}>
            Again
          </button>
        </p>
      ) : null;
    await render(
      <TestProvider transport={transport}>
        <ReportThread reportId={id} renderError={renderError} />
      </TestProvider>,
    );
    await expect.element(page.getByRole("alert").getByText("Reports are down.")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Again" }));
    // The second failure is not one the host handles: the default notice.
    await expect
      .element(page.getByRole("alert").getByText("Could not load the bug report."))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Try again" }));
    await expect.element(page.getByRole("heading", { name: "Wrong figure" })).toBeVisible();
  });

  it("passes not found to renderError too", async () => {
    await render(
      <TestProvider transport={createMemoryTransport()}>
        <ReportThread
          reportId="missing"
          renderError={(error) =>
            error instanceof ElicitorTransportError && error.code === "not_found" ? (
              <p>No such report here.</p>
            ) : undefined
          }
        />
      </TestProvider>,
    );
    await expect.element(page.getByText("No such report here.")).toBeVisible();
  });
});

describe("<ReportList /> rows", () => {
  /** Records whether React's handler prevented a click, then stops the navigation itself. */
  const watchClicks = () => {
    const prevented: Array<boolean> = [];
    const listener = (event: MouseEvent) => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", listener);
    return { prevented, stop: () => window.removeEventListener("click", listener) };
  };

  it("renders links with getHref; a plain click selects, a modified click is the link's", async () => {
    const transport = createMemoryTransport();
    const { id } = await createReport(transport, "Wrong figure");
    const onSelect = vi.fn();
    await render(
      <TestProvider transport={transport}>
        <ReportList getHref={(item) => `/reports/${item.id}`} onSelect={onSelect} />
      </TestProvider>,
    );
    const link = page.getByRole("link", { name: /Wrong figure/ });
    await expect.element(link).toHaveAttribute("href", `/reports/${id}`);
    const clicks = watchClicks();
    try {
      link
        .element()
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      expect(onSelect).not.toHaveBeenCalled();
      await userEvent.click(link);
      expect(onSelect).toHaveBeenCalledWith(id);
      expect(clicks.prevented).toEqual([false, true]);
    } finally {
      clicks.stop();
    }
  });

  it("leaves navigation to the link without onSelect", async () => {
    const transport = createMemoryTransport();
    await createReport(transport, "Wrong figure");
    await render(
      <TestProvider transport={transport}>
        <ReportList getHref={(item) => `/reports/${item.id}`} />
      </TestProvider>,
    );
    const clicks = watchClicks();
    try {
      await userEvent.click(page.getByRole("link", { name: /Wrong figure/ }));
      expect(clicks.prevented).toEqual([false]);
    } finally {
      clicks.stop();
    }
  });

  it("renders the host's own rows with renderRow", async () => {
    const transport = createMemoryTransport();
    const { id } = await createReport(transport, "Wrong figure");
    const onSelect = vi.fn();
    await render(
      <TestProvider transport={transport}>
        <ReportList
          onSelect={onSelect}
          getHref={(item) => `#${item.id}`}
          renderRow={(item, row) => (
            <button type="button" data-href={row.href} onClick={row.select}>
              {row.unread ? "New: " : ""}
              {item.sentence}
            </button>
          )}
        />
      </TestProvider>,
    );
    const button = page.getByRole("button", { name: "New: Wrong figure" });
    await expect.element(button).toHaveAttribute("data-href", `#${id}`);
    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(id);
    await expect.element(page.getByRole("button", { name: "Wrong figure" })).toBeVisible();
  });

  it("lets the host render its own list error", async () => {
    const transport = createMemoryTransport();
    vi.spyOn(transport, "list").mockRejectedValueOnce(
      new ElicitorTransportError(503, "unavailable"),
    );
    await render(
      <TestProvider transport={transport}>
        <ReportList
          renderError={(error, retry) =>
            error instanceof ElicitorTransportError ? (
              <button type="button" onClick={retry}>
                Reports are down, retry
              </button>
            ) : null
          }
        />
      </TestProvider>,
    );
    await userEvent.click(page.getByRole("button", { name: "Reports are down, retry" }));
    await expect.element(page.getByText("You have no bug reports yet.")).toBeVisible();
  });
});

describe("capture exclusion", () => {
  it("leaves data-elicitor-ui off the components a host page renders", async () => {
    const transport = createMemoryTransport();
    const id = await reportWithSummary(transport);
    const report = await transport.get(id);
    await render(
      <TestProvider transport={transport}>
        <ReportList />
        <ReportThread reportId={id} />
        <SummaryConfirm report={report} />
      </TestProvider>,
    );
    await expect.element(page.getByRole("textbox")).toBeVisible();
    expect(document.querySelectorAll(".elicitor").length).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll("[data-elicitor-ui]")).toHaveLength(0);
  });
});

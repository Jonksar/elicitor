import "./styles.css";
import type { CreateReportInput } from "@elicitor/core";
import { useElicitor } from "@elicitor/react";
import { createMemoryTransport, type MemoryTransport } from "@elicitor/react/testing";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Elicitor } from "./elicitor.tsx";
import { bundles, type Locale } from "./i18n.ts";
import { ReportList } from "./report-list.tsx";
import { createReport, TestProvider } from "./test-helpers.tsx";

afterEach(() => {
  document.documentElement.style.removeProperty("--elicitor-fg");
});

const createSpy = (transport: MemoryTransport) => vi.spyOn(transport, "create");

/** A host page with its own state (a company select) that the widget must leave alone. */
function HostPage({
  transport,
  onMount,
}: {
  readonly transport: MemoryTransport;
  readonly onMount: () => void;
}) {
  const [company, setCompany] = useState("c-0");
  const companyRef = useRef(company);
  companyRef.current = company;
  useEffect(() => onMount(), [onMount]);
  return (
    <TestProvider transport={transport} getMetadata={() => ({ companyId: companyRef.current })}>
      <label>
        Company
        <select value={company} onChange={(event) => setCompany(event.target.value)}>
          <option value="c-0">North</option>
          <option value="c-1">South</option>
        </select>
      </label>
      <Elicitor />
    </TestProvider>
  );
}

/** A host menu entry that opens the widget imperatively. */
function HostButton() {
  const { open } = useElicitor();
  return (
    <button type="button" onClick={() => void open()}>
      Help menu: report
    </button>
  );
}

/** A page with the report list next to the widget. */
function ListPage({ transport }: { readonly transport: MemoryTransport }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <TestProvider transport={transport}>
      <ReportList onSelect={setSelected} selectedId={selected} />
      <Elicitor />
    </TestProvider>
  );
}

/** Opens the widget, marks the whole view and sends one sentence. */
const startReport = async (locale: Locale, sentence: string) => {
  const t = bundles[locale];
  await userEvent.click(page.getByRole("button", { name: t.report }));
  await userEvent.click(page.getByRole("button", { name: t.whole }));
  const dialog = page.getByRole("dialog", { name: t.sentence });
  await expect.element(dialog).toBeVisible();
  await userEvent.fill(dialog.getByRole("textbox", { name: t.sentence }), sentence);
  await userEvent.click(dialog.getByRole("button", { name: t.send }));
};

describe("<Elicitor /> end to end", () => {
  it("runs the whole Estonian flow with the real region select and screenshot", async () => {
    const transport = createMemoryTransport();
    await render(
      <TestProvider transport={transport} locale="et-EE" screenshot>
        <p>Arve kokku: 999,00</p>
        <Elicitor />
      </TestProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Teata veast" }));
    // The real overlay from @elicitor/capture, labelled from the Estonian bundle.
    const overlay = page.getByRole("dialog", { name: bundles.et.mark });
    await expect.element(overlay).toBeVisible();
    await userEvent.click(overlay.getByRole("button", { name: "Terve vaade" }));

    const compose = page.getByRole("dialog", { name: "Mis on valesti?" });
    await expect.element(compose).toBeVisible();
    await expect.element(compose.getByRole("img", { name: "Veateate kuvatõmmis" })).toBeVisible();
    await userEvent.fill(
      compose.getByRole("textbox", { name: "Mis on valesti?" }),
      "Kogusumma on vale",
    );
    await userEvent.click(compose.getByRole("button", { name: "Saada" }));

    const panel = page.getByRole("dialog", { name: "Kogusumma on vale" });
    await expect.element(panel.getByText("Mis peaks seal õigesti olema?")).toBeVisible();
    await expect.element(panel.getByText("Täpsustamisel", { exact: true })).toBeVisible();
    await userEvent.fill(panel.getByRole("textbox", { name: "Sinu vastus" }), "1 250,00");
    await userEvent.click(panel.getByRole("button", { name: "Vasta" }));

    const summary = panel.getByRole("region", { name: "Kogusumma on vale" });
    await expect.element(summary.getByText("Kas see on õige?", { exact: true })).toBeVisible();
    await expect.element(summary.getByText("Peaks olema")).toBeVisible();
    await expect.element(summary.getByText("1 250,00", { exact: true })).toBeVisible();
    await expect.element(summary.getByText("Praegu on")).toBeVisible();
    await expect.element(summary.getByText("Liik")).toBeVisible();
    await expect.element(summary.getByText("Muu", { exact: true })).toBeVisible();
    // While a summary is pending, the reply box is the correction path.
    await expect
      .element(panel.getByRole("textbox", { name: "Paranda või täpsusta" }))
      .toBeVisible();

    await userEvent.click(summary.getByRole("button", { name: "Õige, saada edasi" }));
    await expect.element(panel.getByText("Saadetud", { exact: true })).toBeVisible();
    await expect.element(panel.getByText("Aitäh! Veateade on saadetud.")).toBeVisible();
    const [item] = await transport.list();
    expect(item?.status).toBe("submitted");
    expect(item?.title).toBe("Kogusumma on vale");
  });

  it.each([
    ["en", "The total is wrong", "What should be shown there instead?", /^Summary: /],
    ["fi", "Loppusumma on väärin", "Mitä siinä pitäisi näkyä?", /^Yhteenveto: /],
    ["ru", "Итоговая сумма неверна", "Что должно отображаться вместо этого?", /^Итог: /],
  ] as const)("localises the flow in %s", async (locale, sentence, question, summaryPrefix) => {
    const t = bundles[locale];
    const transport = createMemoryTransport();
    await render(
      <TestProvider transport={transport} locale={locale}>
        <Elicitor />
      </TestProvider>,
    );
    await startReport(locale, sentence);
    const panel = page.getByRole("dialog", { name: sentence });
    await expect.element(panel.getByText(question)).toBeVisible();
    await expect.element(panel.getByText(t.intake, { exact: true })).toBeVisible();
    await expect.element(panel.getByText(t.agent, { exact: true })).toBeVisible();
    await userEvent.fill(panel.getByRole("textbox", { name: t.answer }), "120.00");
    await userEvent.click(panel.getByRole("button", { name: t.reply }));

    const summary = panel.getByRole("region", { name: sentence });
    await expect.element(summary.getByText(t.summaryTitle, { exact: true })).toBeVisible();
    // A correction turns the first summary into a plain message, in the model's language.
    await userEvent.fill(panel.getByRole("textbox", { name: t.correct }), "121.00");
    await userEvent.click(panel.getByRole("button", { name: t.reply }));
    await expect.element(panel.getByText(summaryPrefix)).toBeVisible();
    await expect.element(summary.getByText("121.00", { exact: true })).toBeVisible();
    await expect.element(summary.getByText(t.expected)).toBeVisible();
    await expect.element(summary.getByText(t.actual)).toBeVisible();
    await expect.element(summary.getByText(t.kind_other, { exact: true })).toBeVisible();
    await userEvent.click(summary.getByRole("button", { name: t.confirm }));
    await expect.element(panel.getByText(t.submitted, { exact: true })).toBeVisible();
    await expect.element(panel.getByText(t.sentTitle)).toBeVisible();
    expect((await transport.list())[0]?.status).toBe("submitted");
  });

  it("sends the host's metadata and leaves the host page alone", async () => {
    const transport = createMemoryTransport();
    const create = createSpy(transport);
    const onMount = vi.fn();
    const href = location.href;
    await render(<HostPage transport={transport} onMount={onMount} />);
    await userEvent.selectOptions(page.getByRole("combobox", { name: "Company" }), "c-1");

    await startReport("en", "The total is wrong");
    const panel = page.getByRole("dialog", { name: "The total is wrong" });
    await userEvent.fill(panel.getByRole("textbox", { name: "Your answer" }), "120.00");
    await userEvent.click(panel.getByRole("button", { name: "Reply" }));
    await userEvent.click(panel.getByRole("button", { name: "Correct, send it on" }));
    await expect.element(panel.getByText("Submitted", { exact: true })).toBeVisible();

    const input = create.mock.calls[0]?.[0] as CreateReportInput;
    expect(input.metadata).toEqual({ companyId: "c-1" });
    await expect.element(page.getByRole("combobox", { name: "Company" })).toHaveValue("c-1");
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(location.href).toBe(href);
  });
});

describe("<Elicitor /> details", () => {
  it("makes a correction produce a new summary and confirms only the latest", async () => {
    const transport = createMemoryTransport();
    const confirm = vi.spyOn(transport, "confirm");
    await render(
      <TestProvider transport={transport}>
        <Elicitor />
      </TestProvider>,
    );
    await startReport("en", "The total is wrong");
    const panel = page.getByRole("dialog", { name: "The total is wrong" });
    await userEvent.fill(panel.getByRole("textbox", { name: "Your answer" }), "120.00");
    await userEvent.click(panel.getByRole("button", { name: "Reply" }));
    const summary = panel.getByRole("region", { name: "The total is wrong" });
    await expect.element(summary.getByText("120.00", { exact: true })).toBeVisible();

    // While a summary is pending, the reply box is relabelled as the correction path.
    const correction = panel.getByRole("textbox", { name: "Correct or add detail" });
    await expect
      .element(correction)
      .toHaveAccessibleDescription(
        "Not quite right? Write what to change and the assistant will update the summary.",
      );
    await userEvent.fill(correction, "120.00 including VAT");
    await userEvent.click(panel.getByRole("button", { name: "Reply" }));

    await expect.element(summary.getByText("120.00 including VAT", { exact: true })).toBeVisible();
    // The superseded summary stays in the log as a message, without actions.
    await expect
      .element(panel.getByText(/^Summary: The total is wrong It should be: 120\.00\./))
      .toBeVisible();
    await expect.element(summary.getByText("120.00", { exact: true })).not.toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Correct, send it on" }).elements()).toHaveLength(1);
    await userEvent.click(panel.getByRole("button", { name: "Correct, send it on" }));
    await expect.element(panel.getByText("Submitted", { exact: true })).toBeVisible();
    const report = await transport.get(confirm.mock.calls[0]![0]);
    const lastSummarySeq = report.messages.filter((m) => m.author === "agent").at(-1)?.seq;
    expect(confirm.mock.calls).toEqual([[report.id, lastSummarySeq]]);
    expect(lastSummarySeq).toBe(6);
  });

  it("replaces a single text through the provider's messages", async () => {
    await render(
      <TestProvider transport={createMemoryTransport()} messages={{ report: "Found a bug?" }}>
        <Elicitor />
      </TestProvider>,
    );
    await expect.element(page.getByRole("button", { name: "Found a bug?" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Found a bug?" }));
    // Other keys keep the bundle's text.
    await expect.element(page.getByRole("button", { name: "Whole screen" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByRole("button", { name: "Whole screen" }))
      .not.toBeInTheDocument();
  });

  it("renders a custom trigger through the render prop", async () => {
    await render(
      <TestProvider transport={createMemoryTransport()}>
        <Elicitor
          trigger={({ open, busy }) => (
            <button type="button" onClick={open} data-busy={busy}>
              Feedback
            </button>
          )}
        />
      </TestProvider>,
    );
    await expect
      .element(page.getByRole("button", { name: "Report a problem" }))
      .not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Feedback" }));
    await expect
      .element(page.getByRole("button", { name: "Feedback" }))
      .toHaveAttribute("data-busy", "true");
    await userEvent.click(page.getByRole("button", { name: "Whole screen" }));
    await expect.element(page.getByRole("dialog", { name: "What is wrong?" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Feedback" }))
      .toHaveAttribute("data-busy", "false");
  });

  it("renders no trigger with trigger={null} and opens from useElicitor().open()", async () => {
    await render(
      <TestProvider transport={createMemoryTransport()}>
        <HostButton />
        <Elicitor trigger={null} />
      </TestProvider>,
    );
    expect(document.querySelector(".el-fab")).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Help menu: report" }));
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("dialog", { name: "What is wrong?" })).toBeVisible();
  });

  it("sets the colour scheme attribute and lets host variables win", async () => {
    await render(
      <TestProvider transport={createMemoryTransport()}>
        <Elicitor colorScheme="dark" className="host-extra" />
      </TestProvider>,
    );
    const trigger = page.getByRole("button", { name: "Report a problem" });
    await expect.element(trigger).toBeVisible();
    const root = trigger.element().closest(".elicitor") as HTMLElement;
    expect(root.dataset.elicitorScheme).toBe("dark");
    expect(root.hasAttribute("data-elicitor-ui")).toBe(true);
    expect(root.classList.contains("host-extra")).toBe(true);
    // The trigger is drawn in the foreground colour: the dark one by default...
    expect(getComputedStyle(trigger.element()).backgroundColor).toBe("rgb(236, 236, 241)");
    // ...and a host variable set on an ancestor wins.
    document.documentElement.style.setProperty("--elicitor-fg", "rgb(1, 2, 3)");
    expect(getComputedStyle(trigger.element()).backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("follows the system scheme by default and forces light", async () => {
    await render(
      <TestProvider transport={createMemoryTransport()}>
        <Elicitor />
        <Elicitor colorScheme="light" trigger={<span>Light trigger</span>} />
      </TestProvider>,
    );
    const system = page.getByRole("button", { name: "Report a problem" }).element();
    const light = page.getByRole("button", { name: "Light trigger" }).element();
    expect(system.closest<HTMLElement>(".elicitor")?.dataset.elicitorScheme).toBe("system");
    expect(light.closest<HTMLElement>(".elicitor")?.dataset.elicitorScheme).toBe("light");
    expect(getComputedStyle(light).backgroundColor).toBe("rgb(24, 24, 27)");
  });

  it("withdraws a report from the thread", async () => {
    const transport = createMemoryTransport();
    await render(
      <TestProvider transport={transport}>
        <Elicitor />
      </TestProvider>,
    );
    await startReport("en", "The total is wrong");
    const panel = page.getByRole("dialog", { name: "The total is wrong" });
    await userEvent.click(panel.getByRole("button", { name: "Withdraw report" }));
    await expect.element(panel.getByText("Withdrawn", { exact: true })).toBeVisible();
    await expect
      .element(panel.getByRole("button", { name: "Withdraw report" }))
      .not.toBeInTheDocument();
    await expect.element(panel.getByRole("textbox")).not.toBeInTheDocument();
    expect((await transport.list())[0]?.status).toBe("withdrawn");
  });

  it("lists reports with status and unread marker, cleared once the report was read", async () => {
    const transport = createMemoryTransport();
    await createReport(transport, "An older report");
    await render(<ListPage transport={transport} />);
    const older = page.getByRole("button", { name: /An older report/ });
    await expect.element(older.getByText("New", { exact: true })).toBeInTheDocument();

    await startReport("en", "The total is wrong");
    const panel = page.getByRole("dialog", { name: "The total is wrong" });
    await expect.element(panel.getByText("What should be shown there instead?")).toBeVisible();
    const row = page.getByRole("button", { name: /The total is wrong/ });
    await expect.element(row.getByText("Clarifying", { exact: true })).toBeVisible();
    await expect.element(row.getByText("#2", { exact: true })).toBeVisible();
    // Read in the panel: not unread, neither while open nor after closing and reloading.
    await expect.element(row.getByText("New", { exact: true })).not.toBeInTheDocument();
    const list = vi.spyOn(transport, "list");
    await userEvent.click(panel.getByRole("button", { name: "Close" }));
    await expect.element(panel).not.toBeInTheDocument();
    await expect.poll(() => list.mock.calls.length).toBe(1);
    await expect.element(row.getByText("New", { exact: true })).not.toBeInTheDocument();

    await userEvent.click(older);
    await expect.element(older.getByText("New", { exact: true })).not.toBeInTheDocument();
    await expect.element(older).toHaveAttribute("aria-current", "true");
  });

  it("keeps the sentence and shows an error when creating the report fails", async () => {
    const transport = createMemoryTransport();
    const create = createSpy(transport).mockRejectedValueOnce(new Error("offline"));
    await render(
      <TestProvider transport={transport}>
        <Elicitor />
      </TestProvider>,
    );
    await startReport("en", "The total is wrong");
    const dialog = page.getByRole("dialog", { name: "What is wrong?" });
    await expect
      .element(dialog.getByRole("alert"))
      .toHaveTextContent("Could not save the bug report. Try again.");
    await expect.element(dialog.getByRole("textbox")).toHaveValue("The total is wrong");
    await userEvent.click(dialog.getByRole("button", { name: "Send" }));
    await expect.element(page.getByRole("dialog", { name: "The total is wrong" })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("closes the compose dialog with Escape and returns focus to the trigger", async () => {
    await render(
      <TestProvider transport={createMemoryTransport()}>
        <Elicitor />
      </TestProvider>,
    );
    const trigger = page.getByRole("button", { name: "Report a problem" });
    await userEvent.click(trigger);
    await userEvent.click(page.getByRole("button", { name: "Whole screen" }));
    const dialog = page.getByRole("dialog", { name: "What is wrong?" });
    await expect.element(dialog).toHaveAttribute("aria-modal", "true");
    await expect.element(dialog.getByRole("textbox")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });

  it("keeps Tab inside the compose dialog", async () => {
    await render(
      <TestProvider transport={createMemoryTransport()}>
        <button type="button">Host button</button>
        <Elicitor />
      </TestProvider>,
    );
    await userEvent.click(page.getByRole("button", { name: "Report a problem" }));
    await userEvent.click(page.getByRole("button", { name: "Whole screen" }));
    const dialog = page.getByRole("dialog", { name: "What is wrong?" });
    await userEvent.fill(dialog.getByRole("textbox"), "Text");
    await userEvent.tab(); // Cancel
    await userEvent.tab(); // Send
    await expect.element(dialog.getByRole("button", { name: "Send" })).toHaveFocus();
    await userEvent.tab(); // wraps to Close
    await expect.element(dialog.getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect.element(dialog.getByRole("button", { name: "Send" })).toHaveFocus();
  });

  it("leaves the widget's own text out of the captured region text", async () => {
    const transport = createMemoryTransport();
    await createReportThroughUi(transport);
    const create = createSpy(transport);
    await startReport("en", "Second report");
    await expect.element(page.getByRole("dialog", { name: "Second report" })).toBeVisible();
    const input = create.mock.calls[0]?.[0] as CreateReportInput;
    expect(input.regionText).toContain("Order total: 999.00");
    const captured = input.regionText.join("\n");
    expect(captured).not.toContain("Report a problem");
    expect(captured).not.toContain("My bug reports");
    expect(captured).not.toContain("The total is wrong");
  });
});

/** A host page with text, a populated report list and the widget; one report made through the UI. */
async function createReportThroughUi(transport: MemoryTransport) {
  await render(
    <TestProvider transport={transport}>
      <main>
        <p>Order total: 999.00</p>
      </main>
      <ReportList />
      <Elicitor />
    </TestProvider>,
  );
  await startReport("en", "The total is wrong");
  const panel = page.getByRole("dialog", { name: "The total is wrong" });
  await expect.element(panel.getByText("What should be shown there instead?")).toBeVisible();
  await userEvent.click(panel.getByRole("button", { name: "Close" }));
  await expect.element(page.getByText("The total is wrong", { exact: true })).toBeVisible();
}

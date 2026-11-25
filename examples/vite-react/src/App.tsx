import { createMemoryTransport } from "@elicitor/react/testing";
import {
  type ColorScheme,
  Elicitor,
  ElicitorProvider,
  ReportList,
  ReportThread,
} from "@elicitor/react-ui";
import { type ReactElement, useEffect, useState } from "react";

// Everything runs in the browser: a scripted fake model and an in-memory store. No server, no API
// key. See ../server.example.ts for the real backend.
const transport = createMemoryTransport({ delayMs: 450 });

const LOCALES = [
  { value: "en", label: "English" },
  { value: "et", label: "Eesti" },
  { value: "fi", label: "Suomi" },
  { value: "ru", label: "Русский" },
] as const;

const SCHEMES: ReadonlyArray<ColorScheme> = ["system", "light", "dark"];

interface Line {
  readonly sku: string;
  readonly item: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

const ORDER: ReadonlyArray<Line> = [
  { sku: "TB-210", item: "Ceramic teapot, 1.2 l", quantity: 2, unitPrice: 34.5 },
  { sku: "CP-044", item: "Stoneware cup", quantity: 6, unitPrice: 9.9 },
  { sku: "LF-118", item: "Loose leaf sampler", quantity: 3, unitPrice: 18.0 },
  { sku: "TR-007", item: "Oak serving tray", quantity: 1, unitPrice: 42.0 },
];

// The bug to report: the shown total ignores one line (the real sum is 224.40).
const SHOWN_TOTAL = 182.4;

const money = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" });

function OrdersCard(): ReactElement {
  return (
    <section className="card" aria-labelledby="order-title">
      <header className="card-head">
        <div>
          <p className="eyebrow">Order 10482 · Placed 3 days ago</p>
          <h1 id="order-title">Order summary</h1>
        </div>
        <span className="pill">Awaiting payment</span>
      </header>
      <table className="lines">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              Unit price
            </th>
            <th scope="col" className="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {ORDER.map((line) => (
            <tr key={line.sku}>
              <td>
                <span className="item">{line.item}</span>
                <span className="sku">{line.sku}</span>
              </td>
              <td className="num">{line.quantity}</td>
              <td className="num">{money.format(line.unitPrice)}</td>
              <td className="num">{money.format(line.quantity * line.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              Total
            </th>
            <td className="num total">{money.format(SHOWN_TOTAL)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="note">
        Something looks off here. Press <strong>Report a problem</strong> in the corner, mark the
        total and say what is wrong in one sentence.
      </p>
    </section>
  );
}

export function App(): ReactElement {
  const [locale, setLocale] = useState("en");
  const [scheme, setScheme] = useState<ColorScheme>("system");
  const [owner, setOwner] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
  }, [scheme]);

  const switchOwner = (next: boolean) => {
    transport.actAs(next);
    setOwner(next);
  };

  return (
    <ElicitorProvider
      transport={transport}
      locale={locale}
      getMetadata={() => ({ orderId: "10482" })}
    >
      <div className="shell">
        <header className="topbar">
          <span className="brand">
            <span className="logo" aria-hidden="true" />
            Teacup Supply <span className="muted">· demo</span>
          </span>
          <div className="controls">
            <label>
              Language
              <select value={locale} onChange={(event) => setLocale(event.target.value)}>
                {LOCALES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Theme
              <select
                value={scheme}
                onChange={(event) => setScheme(event.target.value as ColorScheme)}
              >
                {SCHEMES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={!owner}
                onChange={(event) => switchOwner(!event.target.checked)}
              />
              Act as non-owner
            </label>
          </div>
        </header>
        <main className="layout">
          <OrdersCard />
          <aside className="card reports">
            <ReportList colorScheme={scheme} onSelect={setSelected} selectedId={selected} />
            {selected && (
              <div className="thread">
                <ReportThread
                  key={`${selected}:${owner}`}
                  reportId={selected}
                  showScreenshot
                  colorScheme={scheme}
                />
              </div>
            )}
          </aside>
        </main>
      </div>
      <Elicitor colorScheme={scheme} />
    </ElicitorProvider>
  );
}

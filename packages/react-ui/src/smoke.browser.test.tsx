import "./styles.css";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

test("applies the package stylesheet in the browser", async () => {
  const screen = await render(<div className="elicitor-root">Widget</div>);
  const element = screen.getByText("Widget");
  await expect.element(element).toBeVisible();
  expect(getComputedStyle(element.element()).boxSizing).toBe("border-box");
});

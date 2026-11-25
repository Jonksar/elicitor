import { expect, test } from "vitest";

test("renders a DOM node to a PNG in the browser", async () => {
  const { domToPng } = await import("modern-screenshot");
  const node = document.createElement("div");
  node.textContent = "Hello";
  node.style.cssText = "width:40px;height:20px;background:#fff";
  document.body.append(node);
  const dataUrl = await domToPng(node);
  expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  node.remove();
});

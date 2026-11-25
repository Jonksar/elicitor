import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  captureScreenshot,
  collectContext,
  collectRegionText,
  createConsoleErrorBuffer,
  startRegionSelect,
} from "./index.ts";

const PNG_SIGNATURE = "iVBORw0KGgo";
const scale = () => Math.min(window.devicePixelRatio || 1, 2);

const mount = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
};

const overlay = () => document.querySelector<HTMLElement>("[data-elicitor-overlay]");

const leftovers = () =>
  document.querySelectorAll("[data-elicitor-overlay], [data-elicitor-capture], [data-elicitor-ui]")
    .length;

const pointer = (type: string, x: number, y: number) =>
  overlay()?.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }),
  );

const drag = (from: [number, number], to: [number, number]) => {
  pointer("pointerdown", ...from);
  pointer("pointermove", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  pointer("pointermove", ...to);
  pointer("pointerup", ...to);
};

async function decode(base64: string) {
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const pixel = (x: number, y: number) =>
    [...context.getImageData(x * scale(), y * scale(), 1, 1).data].slice(0, 3);
  return { width: image.width, height: image.height, pixel };
}

afterEach(() => {
  expect(leftovers()).toBe(0);
});

// Ported from the source capture.browser test 1.
it("captures the scrolled viewport with fixed content, nested scroll and a red rectangle", async () => {
  const host = mount(
    '<div style="position:fixed;left:20px;top:20px;width:30px;height:30px;background:rgb(0,255,0)"></div><div style="position:absolute;left:100px;top:600px;width:30px;height:30px;background:rgb(0,0,255)"></div><div style="position:absolute;left:200px;top:600px;width:40px;height:40px;overflow:hidden"><div style="height:200px"></div><div style="height:40px;background:rgb(255,0,255)"></div></div>',
  );
  host.style.height = "2200px";
  const scroller = host.lastElementChild as HTMLElement;
  scroller.scrollTop = 200;
  const previousScroll = window.scrollY;
  window.scrollTo(0, 500);
  try {
    const png = await captureScreenshot({
      x: 400,
      y: 300,
      width: 50,
      height: 50,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    const image = await decode(png);
    expect(image.width).toBe(window.innerWidth * scale());
    expect(image.height).toBe(window.innerHeight * scale());
    expect(image.pixel(30, 30)).toEqual([0, 255, 0]);
    expect(image.pixel(110, 110)).toEqual([0, 0, 255]);
    expect(image.pixel(210, 110)).toEqual([255, 0, 255]);
    expect(image.pixel(400, 320)).toEqual([220, 38, 38]);
  } finally {
    host.remove();
    window.scrollTo(0, previousScroll);
  }
});

// Ported from the source capture.browser test 2.
it("collects unique visible leaf text intersecting the selected viewport region", () => {
  const host = mount(
    '<div style="position:fixed;left:100px;top:500px"><span>1 234,00</span><span>1 234,00</span><span style="display:none">hidden</span></div><span style="position:fixed;left:500px;top:500px">outside</span>',
  );
  try {
    expect(
      collectRegionText({
        x: 90,
        y: 490,
        width: 220,
        height: 50,
        viewportWidth: 1440,
        viewportHeight: 900,
      }),
    ).toEqual(["1 234,00"]);
  } finally {
    host.remove();
  }
});

// Ported from the source capture.browser test 3 (one marker per result in the promise API).
it("lets the reporter select the whole screen with Enter and cancel with Escape", async () => {
  const whole = startRegionSelect();
  expect(document.activeElement).toBe(overlay());
  await userEvent.keyboard("{Enter}");
  const capture = await whole;
  expect(capture?.region).toBeNull();
  expect(capture?.screenshotPng.startsWith(PNG_SIGNATURE)).toBe(true);
  const image = await decode(capture!.screenshotPng);
  expect([image.width, image.height]).toEqual([
    window.innerWidth * scale(),
    window.innerHeight * scale(),
  ]);

  const cancelled = startRegionSelect({ screenshot: false });
  await userEvent.keyboard("{Escape}");
  expect(await cancelled).toBeNull();
});

// Ported from the source capture.browser test 4.
it("activates the focused marker button with Enter and still cancels with Escape", async () => {
  const whole = startRegionSelect({ screenshot: false });
  await userEvent.tab();
  expect(document.activeElement?.hasAttribute("data-elicitor-whole-view")).toBe(true);
  await userEvent.keyboard("{Enter}");
  expect((await whole)?.region).toBeNull();

  const cancelled = startRegionSelect({ screenshot: false });
  await userEvent.tab();
  await userEvent.tab();
  expect(document.activeElement?.hasAttribute("data-elicitor-cancel")).toBe(true);
  await userEvent.keyboard("{Enter}");
  expect(await cancelled).toBeNull();

  const escaped = startRegionSelect({ screenshot: false });
  await userEvent.tab();
  await userEvent.keyboard("{Escape}");
  expect(await escaped).toBeNull();
});

it("drag selects a region and returns it with its text and an outlined PNG without the overlay", async () => {
  const host = mount(
    '<div style="position:fixed;left:100px;top:100px;width:120px;height:60px;background:rgb(0,0,255);color:rgb(0,0,255)"><span>Inside total</span></div><span style="position:fixed;left:600px;top:400px">Far away</span>',
  );
  try {
    const result = startRegionSelect();
    drag([90, 90], [260, 180]);
    expect(overlay()).toBeNull();
    const capture = await result;
    expect(capture?.region).toEqual({
      x: 90,
      y: 90,
      width: 170,
      height: 90,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    expect(capture?.regionText).toEqual(["Inside total"]);
    expect(capture?.screenshotPng.startsWith(PNG_SIGNATURE)).toBe(true);
    const image = await decode(capture!.screenshotPng);
    expect(image.pixel(210, 150)).toEqual([0, 0, 255]);
    expect(image.pixel(90, 120)).toEqual([220, 38, 38]);
  } finally {
    host.remove();
  }
});

it("normalises a drag that runs up and left, clamped to the viewport", async () => {
  const result = startRegionSelect({ screenshot: false });
  drag([200, 150], [-50, -20]);
  expect((await result)?.region).toEqual({
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
});

it("ignores drags without area and draws the rectangle while dragging", async () => {
  const result = startRegionSelect({ screenshot: false });
  drag([100, 100], [100, 300]);
  drag([100, 100], [300, 100]);
  expect(overlay()).not.toBeNull();
  pointer("pointerdown", 10, 10);
  pointer("pointermove", 60, 40);
  const marker = document.querySelector<HTMLElement>("[data-elicitor-region]")!;
  expect(marker.hidden).toBe(false);
  expect([marker.style.width, marker.style.height]).toEqual(["50px", "30px"]);
  pointer("pointermove", 10, 40);
  await userEvent.keyboard("{Enter}");
  // A zero-width rectangle in progress falls back to the whole view.
  expect((await result)?.region).toBeNull();
});

it("returns the whole viewport from the whole-view button with a full-viewport PNG", async () => {
  const result = startRegionSelect({ labels: { wholeView: "Everything" } });
  const button = document.querySelector<HTMLButtonElement>("[data-elicitor-whole-view]")!;
  expect(button.tagName).toBe("BUTTON");
  expect(button.textContent).toBe("Everything");
  await userEvent.click(button);
  const capture = await result;
  expect(capture?.region).toBeNull();
  expect(capture?.screenshotPng.startsWith(PNG_SIGNATURE)).toBe(true);
  const image = await decode(capture!.screenshotPng);
  expect(image.width).toBe(window.innerWidth * scale());
  expect(image.height).toBe(window.innerHeight * scale());
});

it("resolves null from the cancel button and leaves no DOM or focus trap behind", async () => {
  const before = document.createElement("button");
  document.body.append(before);
  before.focus();
  try {
    const result = startRegionSelect();
    expect(document.querySelectorAll("style[data-elicitor-capture]")).toHaveLength(1);
    await userEvent.click(document.querySelector<HTMLElement>("[data-elicitor-cancel]")!);
    expect(await result).toBeNull();
    expect(leftovers()).toBe(0);
    expect(document.activeElement).toBe(before);
  } finally {
    before.remove();
  }
});

it("resolves null on abort, before or during selection", async () => {
  const already = new AbortController();
  already.abort();
  const pending = startRegionSelect({ signal: already.signal });
  expect(overlay()).toBeNull();
  expect(await pending).toBeNull();

  const controller = new AbortController();
  const result = startRegionSelect({ signal: controller.signal });
  expect(overlay()).not.toBeNull();
  controller.abort();
  expect(await result).toBeNull();
  expect(leftovers()).toBe(0);
});

it("resolves null when aborted while the screenshot is being taken", async () => {
  const controller = new AbortController();
  const result = startRegionSelect({ signal: controller.signal });
  overlay()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(overlay()).toBeNull();
  controller.abort();
  expect(await result).toBeNull();
});

it("labels the overlay for assistive technology and applies options", async () => {
  const result = startRegionSelect({
    screenshot: false,
    regionText: false,
    zIndex: 42,
    labels: { hint: "Mark it", cancel: "Stop" },
  });
  const element = overlay()!;
  expect(element.getAttribute("role")).toBe("dialog");
  expect(element.getAttribute("aria-modal")).toBe("true");
  expect(element.getAttribute("aria-label")).toBe("Mark it");
  expect(element.tabIndex).toBe(-1);
  expect(element.style.zIndex).toBe("42");
  expect(document.querySelector("[data-elicitor-hint] p")?.textContent).toBe("Mark it");
  expect(document.querySelector("[data-elicitor-cancel]")?.textContent).toBe("Stop");
  expect(document.querySelector("[data-elicitor-whole-view]")?.textContent).toBe("Use whole view");
  expect(getComputedStyle(element).position).toBe("fixed");
  await userEvent.keyboard("{Enter}");
  expect(await result).toEqual({ region: null, screenshotPng: "", regionText: [] });
});

it("uses the --elicitor-z variable when no zIndex is passed", async () => {
  document.documentElement.style.setProperty("--elicitor-z", "77");
  try {
    const result = startRegionSelect({ screenshot: false });
    expect(getComputedStyle(overlay()!).zIndex).toBe("77");
    await userEvent.keyboard("{Escape}");
    await result;
  } finally {
    document.documentElement.style.removeProperty("--elicitor-z");
  }
  const result = startRegionSelect({ screenshot: false });
  expect(getComputedStyle(overlay()!).zIndex).toBe("2147483000");
  await userEvent.keyboard("{Escape}");
  await result;
});

it("caps region text entries and entry length", async () => {
  const host = mount(
    `<div style="position:fixed;left:0;top:0">${Array.from({ length: 10 }, (_, index) => `<span>item ${index}</span>`).join("")}<span>${"y".repeat(800)}</span></div>`,
  );
  try {
    expect(collectRegionText(null, 3)).toEqual(["item 0", "item 1", "item 2"]);
    expect(collectRegionText(null, 0)).toEqual([]);
    const all = collectRegionText(null);
    expect(all.at(-1)).toHaveLength(500);
    const result = startRegionSelect({ screenshot: false, maxRegionText: 2 });
    await userEvent.keyboard("{Enter}");
    expect((await result)?.regionText).toEqual(["item 0", "item 1"]);
  } finally {
    host.remove();
  }
});

it("caps region text at 200 entries by default", () => {
  const host = mount(
    `<div style="position:fixed;left:0;top:0;width:100px;height:100px;overflow:hidden">${Array.from({ length: 250 }, (_, index) => `<span style="display:block;height:1px;font-size:1px">t${index}</span>`).join("")}</div>`,
  );
  try {
    expect(collectRegionText(null)).toHaveLength(200);
  } finally {
    host.remove();
  }
});

it("leaves elements marked data-elicitor-ui out of the screenshot", async () => {
  const host = mount(
    '<div style="position:fixed;left:50px;top:50px;width:60px;height:60px;background:rgb(0,0,255)"></div><div data-elicitor-ui style="position:fixed;left:40px;top:40px;width:80px;height:80px;background:rgb(0,255,0)"></div>',
  );
  try {
    const image = await decode(await captureScreenshot(null));
    expect(image.pixel(80, 80)).toEqual([0, 0, 255]);
  } finally {
    host.remove();
  }
});

it("leaves the overlay and other Elicitor UI out of region text", () => {
  const host = mount(
    '<span style="position:fixed;left:10px;top:10px">Page text</span><div data-elicitor-ui style="position:fixed;left:10px;top:40px"><p>Widget text</p></div>',
  );
  const result = startRegionSelect({ screenshot: false });
  try {
    const text = collectRegionText(null);
    expect(text).toContain("Page text");
    expect(text).not.toContain("Widget text");
    expect(text.some((entry) => entry.includes("whole view"))).toBe(false);
    expect(text).not.toContain("Cancel");
  } finally {
    overlay()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    host.remove();
  }
  return result;
});

it("collects context with defaults and switches", () => {
  const previousLang = document.documentElement.lang;
  document.documentElement.lang = "de";
  try {
    const requestLog = [
      { tag: "Load", startedAt: "2026-01-01T10:00:00Z", ms: 3, outcome: "ok" as const },
    ];
    const consoleErrors = [{ at: "2026-01-01T10:00:00Z", message: "boom" }];
    const context = collectContext({ bundleId: "abc123", requestLog, consoleErrors });
    expect(context).toEqual({
      language: "de",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      userAgent: navigator.userAgent,
      bundleId: "abc123",
      requestLog,
      consoleErrors,
    });
    expect(context.requestLog).not.toBe(requestLog);
    expect(collectContext({ language: "fr", userAgent: false })).toMatchObject({
      language: "fr",
      userAgent: "",
      bundleId: "",
      requestLog: [],
      consoleErrors: [],
    });
    document.documentElement.lang = "";
    expect(collectContext().language).toBe(navigator.language);
  } finally {
    document.documentElement.lang = previousLang;
  }
});

it("records window errors and unhandled rejections and removes its listeners on uninstall", () => {
  const added = vi.spyOn(window, "addEventListener");
  const removed = vi.spyOn(window, "removeEventListener");
  const original = console.error;
  const buffer = createConsoleErrorBuffer();
  const uninstall = buffer.install();
  try {
    const handler = (type: string) =>
      added.mock.calls.find(([name]) => name === type)?.[1] as (event: Event) => void;
    handler("error")(new ErrorEvent("error", { error: new Error("thrown"), message: "thrown" }));
    handler("error")(new ErrorEvent("error", { message: "script error" }));
    const rejection = Promise.resolve();
    handler("unhandledrejection")(
      new PromiseRejectionEvent("unhandledrejection", { promise: rejection, reason: "rejected" }),
    );
    expect(buffer.entries().map((entry) => entry.message)).toEqual([
      "thrown",
      "script error",
      "rejected",
    ]);
    expect(buffer.entries()[0]?.stack).toContain("thrown");
    uninstall();
    expect(console.error).toBe(original);
    expect(removed.mock.calls.map(([name]) => name)).toEqual(["error", "unhandledrejection"]);
    expect(removed.mock.calls.map(([, listener]) => listener)).toEqual(
      added.mock.calls.map(([, listener]) => listener),
    );
  } finally {
    uninstall();
    added.mockRestore();
    removed.mockRestore();
  }
});

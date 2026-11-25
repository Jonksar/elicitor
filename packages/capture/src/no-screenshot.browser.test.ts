import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { startRegionSelect } from "./index.ts";

const loaded = vi.hoisted(() => ({ count: 0 }));

vi.mock("modern-screenshot", () => {
  loaded.count++;
  return { domToPng: () => Promise.reject(new Error("must not be called")) };
});

it("does not load modern-screenshot when screenshots are off", async () => {
  const result = startRegionSelect({ screenshot: false });
  await userEvent.keyboard("{Enter}");
  expect((await result)?.screenshotPng).toBe("");
  expect(loaded.count).toBe(0);
});

it("loads modern-screenshot on demand and rejects with its error", async () => {
  const result = startRegionSelect();
  await userEvent.keyboard("{Enter}");
  await expect(result).rejects.toThrow("must not be called");
  expect(loaded.count).toBe(1);
  expect(document.querySelector("[data-elicitor-overlay], [data-elicitor-capture]")).toBeNull();
});

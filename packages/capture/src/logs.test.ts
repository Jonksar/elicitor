import type { RequestLogEntry } from "@elicitor/core";
import { afterEach, expect, it, vi } from "vitest";
import { createConsoleErrorBuffer, createRequestLog } from "./logs.ts";

const entry = (tag: string, ms = 1): RequestLogEntry => ({
  tag,
  startedAt: "2026-01-01T10:00:00Z",
  ms,
  outcome: "ok",
});

const realConsoleError = console.error;
afterEach(() => {
  console.error = realConsoleError;
});

it("keeps the latest fifty request summaries in capture order", () => {
  const log = createRequestLog();
  for (let index = 0; index < 55; index++) log.push(entry(`Call${index}`, index));
  const first = log.entries();
  expect(first).toHaveLength(50);
  expect(first[0]?.tag).toBe("Call5");
  first.pop();
  expect(log.entries().at(-1)?.tag).toBe("Call54");
});

it("drops earlier entries on clear, so a new session starts empty", () => {
  const log = createRequestLog();
  log.push({ ...entry("PrivateError"), outcome: "error", message: "Customer A" });
  log.clear();
  expect(log.entries()).toEqual([]);
  log.push(entry("Next"));
  expect(log.entries().map((item) => item.tag)).toEqual(["Next"]);
});

it("honours a custom request log limit", () => {
  const log = createRequestLog(2);
  for (const tag of ["A", "B", "C"]) log.push(entry(tag));
  expect(log.entries().map((item) => item.tag)).toEqual(["B", "C"]);
});

it("keeps the latest thirty console errors and passes calls through", () => {
  const original = vi.fn();
  console.error = original;
  const buffer = createConsoleErrorBuffer();
  const uninstall = buffer.install();
  try {
    for (let index = 0; index < 35; index++) console.error(`error ${index}`, "extra");
    const entries = buffer.entries();
    expect(entries).toHaveLength(30);
    expect(entries[0]?.message).toBe("error 5");
    expect(entries.at(-1)?.message).toBe("error 34");
    expect(original).toHaveBeenCalledTimes(35);
    expect(original).toHaveBeenLastCalledWith("error 34", "extra");
    entries.pop();
    expect(buffer.entries()).toHaveLength(30);
  } finally {
    uninstall();
  }
});

it("records Error messages and stacks capped at 2000 characters", () => {
  console.error = vi.fn();
  const buffer = createConsoleErrorBuffer(5);
  const uninstall = buffer.install();
  try {
    const error = new Error("x".repeat(2500));
    console.error(error);
    console.error({ toString: () => "object value" });
    const [first, second] = buffer.entries();
    expect(first?.message).toHaveLength(2000);
    expect(first?.stack?.length).toBeLessThanOrEqual(2000);
    expect(first?.stack).toBeTruthy();
    expect(first?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(second).toEqual({ at: expect.any(String), message: "object value" });
  } finally {
    uninstall();
  }
});

it("restores console.error on uninstall and stops recording", () => {
  const original = vi.fn();
  console.error = original;
  const buffer = createConsoleErrorBuffer();
  const uninstall = buffer.install();
  expect(console.error).not.toBe(original);
  expect(buffer.install()).toBe(uninstall);
  uninstall();
  expect(console.error).toBe(original);
  console.error("after");
  expect(buffer.entries()).toEqual([]);
  uninstall();
  expect(console.error).toBe(original);
});

it("stops recording on uninstall even when console.error was wrapped again since", () => {
  const original = vi.fn();
  console.error = original;
  const buffer = createConsoleErrorBuffer();
  const uninstall = buffer.install();
  const ours = console.error;
  const later = vi.fn((...args: unknown[]) => ours(...args));
  console.error = later;
  uninstall();
  expect(console.error).toBe(later);
  console.error("after");
  expect(buffer.entries()).toEqual([]);
  expect(original).toHaveBeenCalledWith("after");
});

it("clear empties the console error buffer", () => {
  console.error = vi.fn();
  const buffer = createConsoleErrorBuffer();
  const uninstall = buffer.install();
  console.error("one");
  buffer.clear();
  expect(buffer.entries()).toEqual([]);
  uninstall();
});

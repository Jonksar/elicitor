import { expect, test } from "vitest";
import {
  ElicitorError,
  IntakeUnavailable,
  isElicitorError,
  isIntakeUnavailable,
} from "./errors.ts";

test("errors carry their reason or code and a cause", () => {
  const cause = new Error("down");
  const error = new IntakeUnavailable("gateway", { cause });
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("IntakeUnavailable");
  expect(error.reason).toBe("gateway");
  expect(error.cause).toBe(cause);
  expect("cause" in new IntakeUnavailable("refusal")).toBe(false);
  const refused = new ElicitorError("stale");
  expect(refused.name).toBe("ElicitorError");
  expect(refused.code).toBe("stale");
});

test("guards recognise errors from another copy of the package", () => {
  const brand = (name: string) => Symbol.for(`@elicitor/core/${name}`);
  const foreignUnavailable = Object.assign(new Error("x"), {
    reason: "refusal",
    [brand("IntakeUnavailable")]: true,
  });
  const foreignError = Object.assign(new Error("x"), {
    code: "not_found",
    [brand("ElicitorError")]: true,
  });
  expect(isIntakeUnavailable(new IntakeUnavailable("gateway"))).toBe(true);
  expect(isIntakeUnavailable(foreignUnavailable)).toBe(true);
  expect(isIntakeUnavailable({ ...foreignUnavailable, reason: "other" })).toBe(false);
  expect(isIntakeUnavailable(new Error("x"))).toBe(false);
  expect(isIntakeUnavailable(null)).toBe(false);
  expect(isIntakeUnavailable(foreignError)).toBe(false);
  expect(isElicitorError(new ElicitorError("invalid"))).toBe(true);
  expect(isElicitorError(foreignError)).toBe(true);
  expect(isElicitorError(foreignUnavailable)).toBe(false);
});

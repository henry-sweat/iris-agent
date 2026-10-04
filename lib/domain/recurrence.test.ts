import { describe, expect, it } from "vitest";
import { validateRule } from "./recurrence";

describe("validateRule", () => {
  it("normalizes an RRULE: prefix", () => {
    expect(validateRule("RRULE:FREQ=WEEKLY;BYDAY=TU,TH,SA")).toBe("FREQ=WEEKLY;BYDAY=TU,TH,SA");
  });

  it("rejects DTSTART, sub-daily and unparseable rules", () => {
    for (const rule of ["DTSTART:20260101T000000Z;FREQ=DAILY", "FREQ=MINUTELY", "FREQ=DAILY;BYDAY=XX", "nonsense"]) {
      expect(() => validateRule(rule), rule).toThrow(/Invalid rrule/);
    }
  });
});

import { Frequency, rrulestr } from "rrule";
import { isoToUTC, utcToISO } from "./dates";
import { DomainError, type ISODate } from "./types";

// Occurrences are date-granular, so sub-daily rules make no sense.
const ALLOWED_FREQS = new Set([Frequency.DAILY, Frequency.WEEKLY, Frequency.MONTHLY, Frequency.YEARLY]);

/**
 * Validates an RFC 5545 rule body and returns it normalized (no `RRULE:` prefix).
 * Throws INVALID_RRULE; the task's startDate supplies DTSTART, so the rule must not.
 */
export function validateRule(rrule: string): string {
  const rule = rrule.trim().replace(/^RRULE:/i, "");
  const invalid = (why: string) => new DomainError("INVALID_RRULE", `Invalid rrule "${rrule}": ${why}`);
  if (rule.length === 0) throw invalid("empty rule");
  if (/DTSTART/i.test(rule)) throw invalid("must not contain DTSTART; startDate supplies it");
  if (/[\r\n]/.test(rule)) throw invalid("must be a single RRULE body");
  if (!/(^|;)FREQ=/i.test(rule)) throw invalid("FREQ is required");
  let freq: Frequency;
  try {
    freq = rrulestr(rule, { dtstart: isoToUTC("2000-01-01") }).options.freq;
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  if (!ALLOWED_FREQS.has(freq)) throw invalid("FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY");
  return rule;
}

/** Dates in [from, to] (inclusive) on which the rule anchored at startDate fires. */
export function expandRule(rrule: string, startDate: ISODate, from: ISODate, to: ISODate): ISODate[] {
  const rule = rrulestr(rrule, { dtstart: isoToUTC(startDate) });
  return rule.between(isoToUTC(from), isoToUTC(to), true).map(utcToISO);
}

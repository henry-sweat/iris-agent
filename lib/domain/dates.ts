import { DomainError, ISODate } from "./types";

// Occurrences are date-granular. Dates are handled as "floating" UTC midnights, so DST in the
// user's zone can never move an occurrence to another day; the zone only decides what "today" is.

/** The calendar date of `instant` in `timeZone`. */
export function dateIn(timeZone: string, instant: Date | number): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function isoToUTC(date: ISODate): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function utcToISO(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = isoToUTC(date);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToISO(d);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((isoToUTC(to).getTime() - isoToUTC(from).getTime()) / 86_400_000);
}

export function parseDate(value: string, field = "date"): ISODate {
  const result = ISODate.safeParse(value);
  if (!result.success) throw new DomainError("INVALID_DATE", `${field} must be a valid YYYY-MM-DD date, got "${value}"`);
  return result.data;
}

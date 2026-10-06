import type { calendar_v3 } from "@googleapis/calendar";
import { TIME_ZONE } from "@/lib/domain/config";
import { addDays, dateIn, daysBetween, parseDate } from "@/lib/domain/dates";
import { DomainError, type ISODate, type ISODateTime } from "@/lib/domain/types";
import { googleClient } from "./google";

/** Upper bound on a calendar read, so the agent's context stays small. */
export const MAX_CALENDAR_RANGE_DAYS = 31;
const PAGE_SIZE = 250;
const MAX_EVENTS = 500;
const MAX_DESCRIPTION = 300;

type ListParams = calendar_v3.Params$Resource$Events$List;
type GoogleEvent = calendar_v3.Schema$Event;

/** The slice of the Calendar API Iris uses, always on the primary calendar; tests inject a fake. */
export type CalendarClient = {
  listEvents(params: ListParams): Promise<{ items: GoogleEvent[]; nextPageToken?: string }>;
  insertEvent(event: GoogleEvent): Promise<GoogleEvent>;
  patchEvent(eventId: string, event: GoogleEvent): Promise<GoogleEvent>;
  deleteEvent(eventId: string): Promise<void>;
};

export type CalendarEvent = {
  id: string;
  title: string;
  allDay: boolean;
  /** YYYY-MM-DD for all-day events (end inclusive), else an offset datetime in the user's zone. */
  start: ISODate | ISODateTime;
  end: ISODate | ISODateTime;
  location?: string;
  myResponse?: string;
  description?: string;
  /** Set when Iris created this event for an appointment task; that task is the same commitment. */
  irisTaskId?: string;
};

export type CalendarEvents = {
  today: ISODate;
  from: ISODate;
  to: ISODate;
  timeZone: string;
  events: CalendarEvent[];
  truncated?: true;
};

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Reads the user's primary Google Calendar. Writes go through ./appointments.
export function createCalendarService({
  client,
  timeZone,
  now = () => new Date(),
}: {
  client: CalendarClient;
  timeZone: string;
  now?: () => Date;
}) {
  /** The event as a compact record, or null if it doesn't touch [from, to] or the user isn't going. */
  function toEvent(event: GoogleEvent, from: ISODate, to: ISODate): CalendarEvent | null {
    if (event.status === "cancelled") return null;
    const myResponse = event.attendees?.find((a) => a.self)?.responseStatus ?? undefined;
    if (myResponse === "declined") return null;

    let range: { start: string; end: string; first: ISODate; last: ISODate };
    if (event.start?.date && event.end?.date) {
      // All-day end dates are exclusive.
      const last = addDays(event.end.date, -1);
      range = { start: event.start.date, end: last, first: event.start.date, last };
    } else if (event.start?.dateTime && event.end?.dateTime) {
      const start = new Date(event.start.dateTime).getTime();
      const end = Math.max(start, new Date(event.end.dateTime).getTime() - 1);
      range = {
        start: event.start.dateTime,
        end: event.end.dateTime,
        first: dateIn(timeZone, start),
        last: dateIn(timeZone, end),
      };
    } else {
      return null;
    }
    if (range.first > to || range.last < from) return null;

    const description = event.description?.trim();
    const irisTaskId = event.extendedProperties?.private?.irisTaskId;
    return {
      id: event.id ?? "",
      title: event.summary ?? "(no title)",
      allDay: Boolean(event.start.date),
      start: range.start,
      end: range.end,
      ...(event.location && { location: event.location }),
      ...(myResponse && { myResponse }),
      ...(description && {
        description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}…` : description,
      }),
      ...(irisTaskId && { irisTaskId }),
    };
  }

  return {
    async listEvents(fromInput: string, toInput: string): Promise<CalendarEvents> {
      const from = parseDate(fromInput, "from");
      const to = parseDate(toInput, "to");
      const days = daysBetween(from, to) + 1;
      if (days < 1) throw new DomainError("INVALID_DATE", "`to` must not be before `from`");
      if (days > MAX_CALENDAR_RANGE_DAYS) {
        throw new DomainError("RANGE_TOO_LARGE", `Range is ${days} days; the maximum is ${MAX_CALENDAR_RANGE_DAYS}`);
      }

      // Pad the UTC window by a day on each side so no zone offset can clip it, then filter by local date.
      const params: ListParams = {
        calendarId: "primary",
        timeMin: `${addDays(from, -1)}T00:00:00Z`,
        timeMax: `${addDays(to, 2)}T00:00:00Z`,
        timeZone,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: PAGE_SIZE,
      };
      const raw: GoogleEvent[] = [];
      let pageToken: string | undefined;
      try {
        do {
          const page = await client.listEvents({ ...params, pageToken });
          raw.push(...page.items);
          pageToken = page.nextPageToken;
        } while (pageToken && raw.length < MAX_EVENTS);
      } catch (error) {
        throw new DomainError("CALENDAR_UNAVAILABLE", `Google Calendar request failed: ${errorMessage(error)}`);
      }

      const events = raw.flatMap((e) => toEvent(e, from, to) ?? []);
      return {
        today: dateIn(timeZone, now()),
        from,
        to,
        timeZone,
        events: events.slice(0, MAX_EVENTS),
        ...((pageToken || events.length > MAX_EVENTS) && { truncated: true as const }),
      };
    },
  };
}

export type CalendarService = ReturnType<typeof createCalendarService>;

/** The app-wide instance, or null when Google Calendar isn't configured. */
export const calendarService: CalendarService | null = googleClient
  ? createCalendarService({ client: googleClient, timeZone: TIME_ZONE })
  : null;

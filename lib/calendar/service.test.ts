import { describe, expect, it } from "vitest";
import { type CalendarClient, createCalendarService } from "./service";

type Page = Awaited<ReturnType<CalendarClient["listEvents"]>>;

function service(pages: Page[] | (() => never)) {
  const calls: Parameters<CalendarClient["listEvents"]>[0][] = [];
  const client: CalendarClient = {
    async listEvents(params) {
      calls.push(params);
      if (typeof pages === "function") return pages();
      return pages[calls.length - 1] ?? { items: [] };
    },
    insertEvent: () => Promise.reject(new Error("unused")),
    patchEvent: () => Promise.reject(new Error("unused")),
    deleteEvent: () => Promise.reject(new Error("unused")),
  };
  const calendar = createCalendarService({
    client,
    timeZone: "America/New_York",
    now: () => new Date("2026-10-05T14:00:00Z"),
  });
  return { calendar, calls };
}

const timed = (id: string, start: string, end: string, extra = {}) => ({
  id,
  summary: id,
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});
const allDay = (id: string, start: string, end: string) => ({ id, summary: id, start: { date: start }, end: { date: end } });

describe("calendar service", () => {
  it("keeps events by local date, not UTC date", async () => {
    const { calendar, calls } = service([
      {
        items: [
          timed("late", "2026-10-06T23:00:00-04:00", "2026-10-06T23:30:00-04:00"), // 03:00Z on the 7th
          timed("next-day", "2026-10-07T01:00:00-04:00", "2026-10-07T02:00:00-04:00"),
          timed("ends-at-midnight", "2026-10-04T23:00:00-04:00", "2026-10-05T00:00:00-04:00"),
          timed("crosses-midnight", "2026-10-04T23:00:00-04:00", "2026-10-05T01:00:00-04:00"),
        ],
      },
    ]);
    const result = await calendar.listEvents("2026-10-05", "2026-10-06");
    expect(result.events.map((e) => e.id)).toEqual(["late", "crosses-midnight"]);
    expect(result).toMatchObject({ today: "2026-10-05", timeZone: "America/New_York" });
    expect(calls[0]).toMatchObject({
      calendarId: "primary",
      timeMin: "2026-10-04T00:00:00Z",
      timeMax: "2026-10-08T00:00:00Z",
      singleEvents: true,
    });
  });

  it("treats all-day end dates as exclusive", async () => {
    const { calendar } = service([
      {
        items: [
          allDay("ended-before", "2026-10-04", "2026-10-05"),
          allDay("multi-day", "2026-10-03", "2026-10-07"),
          allDay("starts-after", "2026-10-07", "2026-10-08"),
        ],
      },
    ]);
    const { events } = await calendar.listEvents("2026-10-05", "2026-10-06");
    expect(events).toEqual([{ id: "multi-day", title: "multi-day", allDay: true, start: "2026-10-03", end: "2026-10-06" }]);
  });

  it("omits cancelled and declined events", async () => {
    const { calendar } = service([
      {
        items: [
          timed("cancelled", "2026-10-05T09:00:00-04:00", "2026-10-05T10:00:00-04:00", { status: "cancelled" }),
          timed("declined", "2026-10-05T09:00:00-04:00", "2026-10-05T10:00:00-04:00", {
            attendees: [{ self: true, responseStatus: "declined" }],
          }),
          timed("tentative", "2026-10-05T09:00:00-04:00", "2026-10-05T10:00:00-04:00", {
            attendees: [{ self: true, responseStatus: "tentative" }, { responseStatus: "declined" }],
          }),
        ],
      },
    ]);
    const { events } = await calendar.listEvents("2026-10-05", "2026-10-05");
    expect(events.map((e) => [e.id, e.myResponse])).toEqual([["tentative", "tentative"]]);
  });

  it("marks events that mirror an appointment task", async () => {
    const { calendar } = service([
      {
        items: [
          timed("dentist", "2026-10-05T15:00:00-04:00", "2026-10-05T16:00:00-04:00", {
            extendedProperties: { private: { irisTaskId: "task-dentist" } },
          }),
        ],
      },
    ]);
    const { events } = await calendar.listEvents("2026-10-05", "2026-10-05");
    expect(events[0].irisTaskId).toBe("task-dentist");
  });

  it("follows pages and flags truncation", async () => {
    const page = (n: number, token?: string): Page => ({
      items: Array.from({ length: 250 }, (_, i) =>
        timed(`${n}-${i}`, "2026-10-05T09:00:00-04:00", "2026-10-05T10:00:00-04:00"),
      ),
      nextPageToken: token,
    });
    const { calendar, calls } = service([page(1, "a"), page(2, "b"), page(3)]);
    const result = await calendar.listEvents("2026-10-05", "2026-10-05");
    expect(calls.map((c) => c.pageToken)).toEqual([undefined, "a"]);
    expect(result.events).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });

  it("validates the range", async () => {
    const { calendar } = service([]);
    await expect(calendar.listEvents("2026-10-01", "2026-11-01")).rejects.toMatchObject({ code: "RANGE_TOO_LARGE" });
    await expect(calendar.listEvents("2026-10-05", "2026-10-04")).rejects.toMatchObject({ code: "INVALID_DATE" });
    await expect(calendar.listEvents("nope", "2026-10-04")).rejects.toMatchObject({ code: "INVALID_DATE" });
  });

  it("maps client failures to CALENDAR_UNAVAILABLE", async () => {
    const { calendar } = service(() => {
      throw new Error("invalid_grant");
    });
    await expect(calendar.listEvents("2026-10-05", "2026-10-05")).rejects.toMatchObject({
      code: "CALENDAR_UNAVAILABLE",
      message: expect.stringContaining("invalid_grant"),
    });
  });
});

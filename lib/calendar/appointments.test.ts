import type { calendar_v3 } from "@googleapis/calendar";
import { describe, expect, it } from "vitest";
import { createAppointmentCalendar } from "./appointments";
import type { CalendarClient } from "./service";

const gone = () => Object.assign(new Error("Not Found"), { status: 404 });

function setup(overrides: Partial<CalendarClient> = {}) {
  const calls: [string, ...unknown[]][] = [];
  const client: CalendarClient = {
    listEvents: () => Promise.reject(new Error("unused")),
    async insertEvent(event) {
      calls.push(["insert", event]);
      return { id: "new-event" };
    },
    async patchEvent(eventId, event) {
      calls.push(["patch", eventId, event]);
      return { id: eventId };
    },
    async deleteEvent(eventId) {
      calls.push(["delete", eventId]);
    },
    ...overrides,
  };
  return { calendar: createAppointmentCalendar({ client, timeZone: "America/New_York" }), calls };
}

const input = {
  taskId: "task-dentist",
  title: "Dentist",
  date: "2026-11-02", // The day after DST ends; Google resolves the offset from timeZone.
  appointment: { start: "15:00", end: "16:00", location: "Main St" },
};

describe("appointment calendar", () => {
  it("inserts a tagged event with wall-clock times in the user's zone", async () => {
    const { calendar, calls } = setup();
    expect(await calendar.upsert(input)).toBe("new-event");
    expect(calls).toEqual([
      [
        "insert",
        {
          summary: "Dentist",
          location: "Main St",
          start: { dateTime: "2026-11-02T15:00:00", timeZone: "America/New_York" },
          end: { dateTime: "2026-11-02T16:00:00", timeZone: "America/New_York" },
          extendedProperties: { private: { irisTaskId: "task-dentist" } },
        } satisfies calendar_v3.Schema$Event,
      ],
    ]);
  });

  it("patches the linked event, and recreates it if it was deleted in Google Calendar", async () => {
    const linked = { ...input, appointment: { ...input.appointment, eventId: "evt-1" } };
    const ok = setup();
    expect(await ok.calendar.upsert(linked)).toBe("evt-1");
    expect(ok.calls.map((c) => c.slice(0, 2))).toEqual([["patch", "evt-1"]]);

    const deleted = setup({ patchEvent: () => Promise.reject(gone()) });
    expect(await deleted.calendar.upsert(linked)).toBe("new-event");
    expect(deleted.calls.map((c) => c[0])).toEqual(["insert"]);
  });

  it("ignores already-deleted events on remove and reports other failures", async () => {
    await expect(setup({ deleteEvent: () => Promise.reject(gone()) }).calendar.remove("evt-1")).resolves.toBeUndefined();
    const failing = setup({ insertEvent: () => Promise.reject(new Error("invalid_grant")) });
    await expect(failing.calendar.upsert(input)).rejects.toMatchObject({
      code: "CALENDAR_UNAVAILABLE",
      message: expect.stringContaining("invalid_grant"),
    });
  });
});

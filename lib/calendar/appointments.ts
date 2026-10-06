import { TIME_ZONE } from "@/lib/domain/config";
import { type Appointment, DomainError, type ISODate } from "@/lib/domain/types";
import { googleClient } from "./google";
import { type CalendarClient, errorMessage } from "./service";

export type AppointmentInput = { taskId: string; title: string; date: ISODate; appointment: Appointment };

/** Writes Iris's own appointment events. Only ever touches event ids it created, so other events are safe. */
export type AppointmentCalendar = {
  /** Creates the event, or updates it when `appointment.eventId` is set; returns the event id. */
  upsert(input: AppointmentInput): Promise<string>;
  remove(eventId: string): Promise<void>;
};

/** HTTP status of a failed Google API call, if any. */
const statusOf = (error: unknown) => {
  const e = error as { status?: number; response?: { status?: number } } | null;
  return e?.status ?? e?.response?.status;
};
const isGone = (error: unknown) => statusOf(error) === 404 || statusOf(error) === 410;

export function createAppointmentCalendar({
  client,
  timeZone,
}: {
  client: CalendarClient;
  timeZone: string;
}): AppointmentCalendar {
  const fail = (error: unknown): never => {
    throw new DomainError("CALENDAR_UNAVAILABLE", `Google Calendar request failed: ${errorMessage(error)}`);
  };

  return {
    async upsert({ taskId, title, date, appointment }) {
      // Wall-clock datetimes plus timeZone; Google resolves the offset, including DST.
      const event = {
        summary: title,
        location: appointment.location ?? "",
        start: { dateTime: `${date}T${appointment.start}:00`, timeZone },
        end: { dateTime: `${date}T${appointment.end}:00`, timeZone },
        extendedProperties: { private: { irisTaskId: taskId } },
      };
      try {
        if (appointment.eventId) {
          try {
            return (await client.patchEvent(appointment.eventId, event)).id ?? appointment.eventId;
          } catch (error) {
            // Deleted in Google Calendar; the task still says it's an appointment, so put it back.
            if (!isGone(error)) throw error;
          }
        }
        const created = await client.insertEvent(event);
        if (!created.id) throw new Error("Google returned an event without an id");
        return created.id;
      } catch (error) {
        return fail(error);
      }
    },

    async remove(eventId) {
      try {
        await client.deleteEvent(eventId);
      } catch (error) {
        if (!isGone(error)) fail(error);
      }
    },
  };
}

/** The app-wide instance, or null when Google Calendar isn't configured. */
export const appointmentCalendar: AppointmentCalendar | null = googleClient
  ? createAppointmentCalendar({ client: googleClient, timeZone: TIME_ZONE })
  : null;

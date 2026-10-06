import { auth, calendar } from "@googleapis/calendar";
import { GCAL_CONFIG, type GcalConfig } from "./config";
import type { CalendarClient } from "./service";

const calendarId = "primary";

/** A CalendarClient backed by the Google Calendar API, authorized with the user's refresh token. */
export function createGoogleClient({ clientId, clientSecret, refreshToken }: GcalConfig): CalendarClient {
  const oauth2 = new auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const api = calendar({ version: "v3", auth: oauth2 });
  return {
    async listEvents(params) {
      const { data } = await api.events.list(params);
      return { items: data.items ?? [], nextPageToken: data.nextPageToken ?? undefined };
    },
    async insertEvent(requestBody) {
      return (await api.events.insert({ calendarId, requestBody })).data;
    },
    async patchEvent(eventId, requestBody) {
      return (await api.events.patch({ calendarId, eventId, requestBody })).data;
    },
    async deleteEvent(eventId) {
      await api.events.delete({ calendarId, eventId });
    },
  };
}

/** The app-wide client, or null when Google Calendar isn't configured. */
export const googleClient = GCAL_CONFIG ? createGoogleClient(GCAL_CONFIG) : null;

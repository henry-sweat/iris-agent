// One-time OAuth consent for the Google Calendar integration. Prints a refresh token for .env.local.
// Run with `npm run gcal:auth` after setting GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a Desktop app OAuth client).
// Self-contained on purpose: Node runs it directly, without the app's `@/` path aliases.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import googleCalendar from "@googleapis/calendar";

// Read all events, and create/edit the appointment events Iris owns.
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret || clientId.startsWith("<") || clientSecret.startsWith("<")) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first (a Desktop app OAuth client).");
  process.exit(1);
}

const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const oauth2 = new googleCalendar.auth.OAuth2(clientId, clientSecret, redirectUri);

  server.on("request", async (req, res) => {
    const url = new URL(req.url ?? "/", redirectUri);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (!code && !error) {
      res.writeHead(404).end();
      return;
    }
    try {
      if (error) throw new Error(error);
      const { tokens } = await oauth2.getToken(code!);
      if (!tokens.refresh_token) throw new Error("Google returned no refresh token; revoke the app's access and retry.");
      res.end("Done. You can close this tab and return to the terminal.");
      console.log(`\nAdd this to .env.local:\n\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
      server.close();
    } catch (err) {
      res.writeHead(500).end("Authorization failed; see the terminal.");
      console.error("Authorization failed:", err instanceof Error ? err.message : err);
      server.close();
      process.exitCode = 1;
    }
  });

  const authUrl = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: [SCOPE] });
  console.log(`Open this URL in your browser and approve calendar access:\n\n${authUrl}\n`);
});

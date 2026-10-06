export type GcalConfig = { readonly clientId: string; readonly clientSecret: string; readonly refreshToken: string };

/** `.env.example` ships `<…>` placeholders; treat a copied-but-unfilled value as missing. */
const env = (name: string) => {
  const value = process.env[name]?.trim();
  return value && !value.startsWith("<") ? value : undefined;
};

function readConfig(): GcalConfig | null {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const refreshToken = env("GOOGLE_REFRESH_TOKEN");
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

/** Google Calendar credentials, or null when the (optional) calendar integration isn't configured. */
export const GCAL_CONFIG = readConfig();

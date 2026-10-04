/** Runs once when the Next.js server starts; a throw here aborts startup. */
export function register() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  // `.env.example` ships a `<insert-here>` placeholder; treat a copied-but-unfilled value as missing.
  if (!key || key.startsWith("<")) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and set it before starting the app.",
    );
  }
}

import path from "node:path";

/** IANA zone that defines the user's calendar dates; all "today" math uses it, never the server's zone. */
export const TIME_ZONE = process.env.TODO_TIME_ZONE ?? "America/New_York";

export const DATA_FILE = process.env.TODO_DATA_FILE ?? path.join(process.cwd(), "data", "todo.json");

/** Upper bound on any read range, so a yearly view stays cheap. */
export const MAX_RANGE_DAYS = 366;

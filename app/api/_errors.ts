import { DomainError } from "@/lib/domain/types";

const STATUS: Record<DomainError["code"], number> = {
  NOT_FOUND: 404,
  INVALID_RRULE: 400,
  INVALID_DATE: 400,
  INVALID_INPUT: 400,
  RANGE_TOO_LARGE: 400,
  UNKNOWN_GOAL: 400,
  GOAL_PILLAR_MISMATCH: 409,
  GOAL_CYCLE: 409,
  CALENDAR_UNAVAILABLE: 502,
};

/** Runs a service call, mapping DomainErrors to `{ code, message }` with a 4xx status. */
export async function respond(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (error) {
    if (error instanceof DomainError) {
      return Response.json({ code: error.code, message: error.message }, { status: STATUS[error.code] });
    }
    throw error;
  }
}

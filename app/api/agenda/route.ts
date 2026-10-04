import type { NextRequest } from "next/server";
import { services } from "@/lib/domain/service";
import { respond } from "../_errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/agenda?from=YYYY-MM-DD&to=YYYY-MM-DD; both default to today. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const from = params.get("from") ?? services.today();
  const to = params.get("to") ?? from;
  return respond(() => services.getAgenda(from, to));
}

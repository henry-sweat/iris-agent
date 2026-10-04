import type { NextRequest } from "next/server";
import { z } from "zod";
import { services } from "@/lib/domain/service";
import { respond } from "../../_errors";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["complete", "skip", "reopen"]),
  note: z.string().optional(),
});

/** POST /api/occurrences/:id { action: 'complete' | 'skip' | 'reopen', note? } → AgendaItem */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/occurrences/[id]">) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "INVALID_INPUT", message: body.error.message }, { status: 400 });
  const { action, note } = body.data;
  return respond(() =>
    action === "complete"
      ? services.completeOccurrence(id, note)
      : action === "skip"
        ? services.skipOccurrence(id, note)
        : services.reopenOccurrence(id),
  );
}

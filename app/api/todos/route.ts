import { services } from "@/lib/domain/service";
import { respond } from "../_errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/todos → { today, items }: every occurrence of active ad hoc tasks. */
export async function GET() {
  return respond(() => services.listAdHocItems());
}

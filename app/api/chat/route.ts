import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { runAgent } from "@/lib/agent/run";
import { pipeAgentToUI } from "@/lib/agent/to-ui-stream";
import type { ChatRequestBody, TodoUIMessage } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { message, sessionId }: ChatRequestBody = await req.json();
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();

  if (text.length === 0) {
    return Response.json({ error: "Message text is required" }, { status: 400 });
  }

  const stream = createUIMessageStream<TodoUIMessage>({
    execute: ({ writer }) =>
      pipeAgentToUI(runAgent({ text, sessionId, signal: req.signal }), writer),
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });

  return createUIMessageStreamResponse({ stream });
}

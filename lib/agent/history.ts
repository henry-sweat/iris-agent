import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { displayToolName, toolResultValue } from "./to-ui-stream";
import type { TodoUIMessage } from "./types";

type Block = { type: string; [key: string]: unknown };
type Part = TodoUIMessage["parts"][number];

const blocksOf = (message: unknown): Block[] | string => {
  const content = (message as { content?: unknown } | null)?.content;
  return typeof content === "string" ? content : Array.isArray(content) ? content : [];
};

/**
 * Loads a persisted Agent SDK session as UI messages. Consecutive assistant
 * entries (the SDK stores one per content block) fold into one message, and
 * tool results attach to the tool call that produced them.
 */
export async function loadSessionHistory(sessionId: string): Promise<TodoUIMessage[]> {
  const entries = await getSessionMessages(sessionId, { dir: process.cwd() });
  const messages: TodoUIMessage[] = [];
  const toolParts = new Map<string, Part>();

  for (const entry of entries) {
    if (entry.parent_tool_use_id) continue;
    const blocks = blocksOf(entry.message);

    if (entry.type === "user") {
      if (typeof blocks === "string") {
        messages.push({ id: entry.uuid, role: "user", parts: [{ type: "text", text: blocks }] });
        continue;
      }
      const text = blocks.flatMap((b) => (b.type === "text" ? [String(b.text)] : [])).join("\n");
      for (const block of blocks) {
        if (block.type !== "tool_result") continue;
        const part = toolParts.get(String(block.tool_use_id));
        if (part?.type !== "dynamic-tool") continue;
        const output = toolResultValue(block.content);
        Object.assign(
          part,
          block.is_error
            ? { state: "output-error", errorText: typeof output === "string" ? output : JSON.stringify(output) }
            : { state: "output-available", output },
        );
      }
      if (text) messages.push({ id: entry.uuid, role: "user", parts: [{ type: "text", text }] });
      continue;
    }

    if (entry.type !== "assistant" || typeof blocks === "string") continue;
    let current = messages.at(-1);
    if (current?.role !== "assistant") {
      current = { id: entry.uuid, role: "assistant", parts: [] };
      messages.push(current);
    }
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        current.parts.push({ type: "text", text: String(block.text), state: "done" });
      } else if (block.type === "thinking" && block.thinking) {
        current.parts.push({ type: "reasoning", text: String(block.thinking), state: "done" });
      } else if (block.type === "tool_use") {
        const part: Part = {
          type: "dynamic-tool",
          toolCallId: String(block.id),
          toolName: displayToolName(String(block.name)),
          state: "input-available",
          input: block.input,
        };
        toolParts.set(part.toolCallId, part);
        current.parts.push(part);
      }
    }
  }

  return messages;
}

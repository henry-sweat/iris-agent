import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { UIMessageStreamWriter } from "ai";
import { MUTATING_TOOLS, TODO_SERVER } from "./tools";
import type { TodoUIMessage } from "./types";

const TOOL_PREFIX = `mcp__${TODO_SERVER}__`;

export const displayToolName = (name: string) =>
  name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name;

type Writer = UIMessageStreamWriter<TodoUIMessage>;

/** Normalizes a tool_result's content to a value: parsed JSON when possible, else text. */
export function toolResultValue(content: unknown): unknown {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((block) => (block?.type === "text" ? String(block.text) : ""))
            .join("")
        : "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Translates Agent SDK messages into AI SDK UI message chunks.
 *
 * Text and reasoning come from partial `stream_event`s only (the complete
 * `assistant` message repeats them); tool calls come from the complete
 * `assistant` message, where their input is final.
 */
export async function pipeAgentToUI(messages: AsyncIterable<SDKMessage>, writer: Writer) {
  // content block index -> open text/reasoning part, for the current API message
  const openBlocks = new Map<number, { id: string; kind: "text" | "reasoning" }>();
  const toolNames = new Map<string, string>();
  let apiMessageId = "";

  writer.write({ type: "start" });

  for await (const message of messages) {
    // Subagent traffic (not used today) would interleave with the main thread.
    if ("parent_tool_use_id" in message && message.parent_tool_use_id) continue;

    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          writer.write({
            type: "data-session",
            data: { sessionId: message.session_id },
            transient: true,
          });
        }
        break;

      case "stream_event": {
        const event = message.event;
        switch (event.type) {
          case "message_start":
            apiMessageId = event.message.id;
            openBlocks.clear();
            writer.write({ type: "start-step" });
            break;
          case "content_block_start": {
            const id = `${apiMessageId}:${event.index}`;
            const block = event.content_block;
            if (block.type === "text") {
              openBlocks.set(event.index, { id, kind: "text" });
              writer.write({ type: "text-start", id });
            } else if (block.type === "thinking") {
              openBlocks.set(event.index, { id, kind: "reasoning" });
              writer.write({ type: "reasoning-start", id });
            } else if (block.type === "tool_use") {
              toolNames.set(block.id, block.name);
              writer.write({
                type: "tool-input-start",
                toolCallId: block.id,
                toolName: displayToolName(block.name),
                dynamic: true,
              });
            }
            break;
          }
          case "content_block_delta": {
            const open = openBlocks.get(event.index);
            if (!open) break;
            if (event.delta.type === "text_delta") {
              writer.write({ type: "text-delta", id: open.id, delta: event.delta.text });
            } else if (event.delta.type === "thinking_delta") {
              writer.write({ type: "reasoning-delta", id: open.id, delta: event.delta.thinking });
            }
            break;
          }
          case "content_block_stop": {
            const open = openBlocks.get(event.index);
            if (!open) break;
            openBlocks.delete(event.index);
            writer.write({ type: open.kind === "text" ? "text-end" : "reasoning-end", id: open.id });
            break;
          }
          case "message_stop":
            writer.write({ type: "finish-step" });
            break;
        }
        break;
      }

      case "assistant":
        for (const block of message.message.content) {
          if (block.type !== "tool_use") continue;
          toolNames.set(block.id, block.name);
          writer.write({
            type: "tool-input-available",
            toolCallId: block.id,
            toolName: displayToolName(block.name),
            input: block.input,
            dynamic: true,
          });
        }
        break;

      case "user": {
        const content = message.message.content;
        if (typeof content === "string") break;
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const toolName = displayToolName(toolNames.get(block.tool_use_id) ?? "");
          const output = toolResultValue(block.content);
          if (block.is_error) {
            writer.write({
              type: "tool-output-error",
              toolCallId: block.tool_use_id,
              errorText: typeof output === "string" ? output : JSON.stringify(output),
              dynamic: true,
            });
          } else {
            writer.write({
              type: "tool-output-available",
              toolCallId: block.tool_use_id,
              output,
              dynamic: true,
            });
            if (MUTATING_TOOLS.has(toolName)) {
              writer.write({ type: "data-todos", data: { toolName }, transient: true });
            }
          }
        }
        break;
      }

      case "result":
        if (message.subtype !== "success") {
          writer.write({
            type: "error",
            errorText: message.errors?.join("\n") || `Agent stopped: ${message.subtype}`,
          });
        }
        break;
    }
  }

  writer.write({ type: "finish" });
}

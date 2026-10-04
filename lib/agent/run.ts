import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildSystemPrompt } from "./system-prompt";
import { createTodoServer, TODO_SERVER } from "./tools";

export const MODEL = "sonnet";

/**
 * Runs one agent turn. The SDK owns conversation history; pass the previous
 * turn's session id to continue it.
 */
export async function* runAgent({
  text,
  sessionId,
  signal,
}: {
  readonly text: string;
  readonly sessionId?: string;
  readonly signal: AbortSignal;
}): AsyncGenerator<SDKMessage> {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });

  // SDK MCP servers need streaming input, and the input must stay open until
  // the turn finishes or the tool channel closes early.
  let finishInput: () => void = () => {};
  const inputDone = new Promise<void>((resolve) => (finishInput = resolve));
  abortController.signal.addEventListener("abort", () => finishInput(), { once: true });

  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: sessionId ?? "",
    };
    await inputDone;
  }

  const q = query({
    prompt: prompt(),
    options: {
      model: MODEL,
      systemPrompt: buildSystemPrompt(),
      mcpServers: { [TODO_SERVER]: createTodoServer() },
      tools: [], // No built-in tools (Bash, Read, Edit, …): todos only.
      allowedTools: [`mcp__${TODO_SERVER}__*`],
      settingSources: [], // Hermetic: ignore ~/.claude and project settings.
      cwd: process.cwd(),
      includePartialMessages: true,
      resume: sessionId,
      abortController,
    },
  });

  try {
    for await (const message of q) {
      yield message;
      if (message.type === "result") break;
    }
  } finally {
    finishInput();
    signal.removeEventListener("abort", abort);
    q.close();
  }
}

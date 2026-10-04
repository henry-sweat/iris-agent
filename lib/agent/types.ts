import type { UIMessage } from "ai";

export type TodoDataParts = {
  /** The Agent SDK session id; the client sends it back to continue the conversation. */
  session: { sessionId: string };
  /** A tool changed todo.json; the client refetches the todo panel. */
  todos: { toolName: string };
};

export type TodoUIMessage = UIMessage<unknown, TodoDataParts>;

/** POST /api/chat body. */
export type ChatRequestBody = {
  readonly message: TodoUIMessage;
  readonly sessionId?: string;
};

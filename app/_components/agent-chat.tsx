"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertCircleIcon, BrainIcon, CalendarCheckIcon, ListTodoIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationTopFade,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import type { ChatRequestBody, TodoUIMessage } from "@/lib/agent/types";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { PlannerPanel } from "./planner-panel";
import { TodoPanel } from "./todo-panel";

const AGENT_NAME = "Todo Agent";
const STARTER_PROMPT = "What's on my agenda today, and where should I start?";

export function AgentChat({
  sessionId: initialSessionId,
  initialMessages,
}: {
  readonly sessionId?: string;
  readonly initialMessages?: TodoUIMessage[];
}) {
  // The Agent SDK owns history; each request carries only the new message plus this id.
  const sessionIdRef = useRef(initialSessionId);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionId);
  const [todosVersion, setTodosVersion] = useState(0);
  const [todosOpen, setTodosOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);

  const [transport] = useState(
    () =>
      new DefaultChatTransport<TodoUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            message: messages.at(-1)!,
            sessionId: sessionIdRef.current,
          } satisfies ChatRequestBody,
        }),
      }),
  );

  const { messages, sendMessage, status, stop, error } = useChat<TodoUIMessage>({
    id: initialSessionId,
    messages: initialMessages,
    transport,
    onData(part) {
      if (part.type === "data-session") {
        const { sessionId } = part.data;
        if (sessionIdRef.current === sessionId) return;
        sessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
        // Next patches window.history to navigate, which would detach the active stream.
        History.prototype.replaceState.call(
          window.history,
          window.history.state,
          "",
          `/s/${encodeURIComponent(sessionId)}`,
        );
      } else if (part.type === "data-todos") {
        setTodosVersion((v) => v + 1);
      }
    },
    onFinish() {
      setTodosVersion((v) => v + 1);
    },
  });

  const isBusy = status === "submitted" || status === "streaming";
  const isEmpty = messages.length === 0;
  const lastMessage = messages.at(-1);
  const showPendingThinking =
    isBusy &&
    (lastMessage?.role !== "assistant" ||
      lastMessage.parts.every((part) => part.type === "step-start"));
  const showConversationLayout = !isEmpty || error !== undefined;

  const send = (text: string) => {
    if (text.length === 0 || isBusy) return;
    void sendMessage({ text });
  };

  const handleSubmit = (message: PromptInputMessage) => send(message.text.trim());

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder="Ask about your agenda, tasks or goals…" />
      <PromptInputSubmit onStop={stop} status={isBusy ? status : undefined} />
    </PromptInput>
  );

  return (
    <main className="flex h-dvh overflow-hidden bg-background text-foreground">
      <PlannerPanel onClose={() => setPlannerOpen(false)} open={plannerOpen} refreshKey={todosVersion} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <ChatHeader
          canStartNewChat={activeSessionId !== undefined}
          onShowPlanner={() => setPlannerOpen(true)}
          onShowTodos={() => setTodosOpen(true)}
          showTitle={showConversationLayout}
        />

        {showConversationLayout ? (
          <Conversation
            className="min-h-0 flex-1"
            initial={initialSessionId === undefined ? undefined : false}
            resize={activeSessionId === undefined ? "smooth" : "instant"}
            scrollRestorationKey={
              isEmpty || activeSessionId === undefined
                ? undefined
                : `todo-agent:chat-scroll:${activeSessionId}`
            }
          >
            <ConversationTopFade className="top-14" />
            <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-20 pb-36 sm:px-6">
              {messages.map((message, index) => (
                <AgentMessage
                  isStreaming={status === "streaming" && index === messages.length - 1}
                  key={message.id}
                  message={message}
                />
              ))}
              {showPendingThinking ? <PendingThinking /> : null}
              {error ? <ErrorMessage message={error.message} /> : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        ) : null}

        <div
          className={cn(
            "mx-auto w-full px-4 sm:px-6",
            showConversationLayout
              ? "absolute bottom-0 left-1/2 z-20 max-w-3xl -translate-x-1/2 bg-gradient-to-t from-background via-background to-transparent pt-4 pb-6"
              : "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]",
          )}
        >
          {showConversationLayout ? null : (
            <h1 className="font-medium text-5xl tracking-tighter">{AGENT_NAME}</h1>
          )}
          <div className="w-full">{composer}</div>
          {showConversationLayout ? null : (
            <Button onClick={() => send(STARTER_PROMPT)} size="sm" type="button" variant="outline">
              Where should I start?
            </Button>
          )}
        </div>
      </div>

      <TodoPanel onClose={() => setTodosOpen(false)} open={todosOpen} refreshKey={todosVersion} />
    </main>
  );
}

function ChatHeader({
  canStartNewChat,
  onShowPlanner,
  onShowTodos,
  showTitle,
}: {
  readonly canStartNewChat: boolean;
  readonly onShowPlanner: () => void;
  readonly onShowTodos: () => void;
  readonly showTitle: boolean;
}) {
  return (
    <header className="absolute top-0 right-0 left-0 z-20 flex h-14 items-center justify-between bg-background/80 px-4 backdrop-blur-sm">
      <div className="flex w-24">
        <Button
          aria-label="Show planner"
          className="lg:hidden"
          onClick={onShowPlanner}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <CalendarCheckIcon className="size-4" />
        </Button>
      </div>
      <span className="truncate text-muted-foreground text-sm">{showTitle ? AGENT_NAME : null}</span>
      <div className="flex w-24 justify-end gap-1">
        {canStartNewChat ? (
          <Button
            aria-label="Start a new chat"
            onClick={() => window.location.assign("/")}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon className="size-4" />
            <span className="hidden font-normal text-sm sm:inline">New chat</span>
          </Button>
        ) : null}
        <Button
          aria-label="Show todos"
          className="lg:hidden"
          onClick={onShowTodos}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ListTodoIcon className="size-4" />
        </Button>
      </div>
    </header>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <div
          className="flex w-full items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Request failed</p>
            <p className="mt-0.5 text-muted-foreground">{message}</p>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="mb-4 flex w-full items-center gap-2 text-muted-foreground text-sm">
          <BrainIcon className="size-4" />
          <Shimmer duration={1}>Thinking</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

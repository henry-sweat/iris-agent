import { AgentChat } from "@/app/_components/agent-chat";
import { loadSessionHistory } from "@/lib/agent/history";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  // A missing or unreadable transcript still resumes the session; it just shows no history.
  const initialMessages = await loadSessionHistory(sessionId).catch(() => []);
  return <AgentChat initialMessages={initialMessages} key={sessionId} sessionId={sessionId} />;
}

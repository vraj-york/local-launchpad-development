import { ChatWorkspace } from "@/components/chat-workspace";
import { ErrorBoundary } from "@/components/error-boundary";

export default function Home() {
  return (
    <ErrorBoundary>
      <ChatWorkspace />
    </ErrorBoundary>
  );
}

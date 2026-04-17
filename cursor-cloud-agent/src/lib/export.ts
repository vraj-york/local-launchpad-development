import type { ChatMessage, ToolCallInfo } from "@/lib/types";

function toolCallLine(tc: ToolCallInfo): string {
  const label = tc.type === "shell" ? "Shell" : tc.type === "search" ? "Search" : tc.type === "edit" ? "Edit" : tc.type === "write" ? "Write" : tc.type === "read" ? "Read" : tc.name;
  const target = tc.type === "shell" ? tc.command : tc.path;
  return target ? `> **${label}** \`${target}\`` : `> **${label}**`;
}

export function exportSessionMarkdown(messages: ChatMessage[], toolCalls: ToolCallInfo[]): string {
  const items = [
    ...messages.map((m) => ({ ts: m.timestamp, kind: "msg" as const, msg: m })),
    ...toolCalls.map((tc) => ({ ts: tc.timestamp, kind: "tc" as const, tc })),
  ].sort((a, b) => a.ts - b.ts);

  const parts: string[] = [];

  for (const item of items) {
    if (item.kind === "msg" && item.msg) {
      const role = item.msg.role === "user" ? "User" : "Assistant";
      parts.push(`## ${role}\n\n${item.msg.content}`);
    } else if (item.kind === "tc" && item.tc) {
      parts.push(toolCallLine(item.tc));
    }
  }

  return parts.join("\n\n");
}

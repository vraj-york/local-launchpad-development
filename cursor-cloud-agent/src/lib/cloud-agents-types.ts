/** Cursor Cloud Agents API–compatible shapes (list / status). */

import type { ChatMessage } from "@/lib/types";

export interface CloudAgentSource {
  repository: string;
  ref: string;
  prUrl?: string;
}

export interface CloudAgentTarget {
  branchName?: string;
  url: string;
  prUrl?: string;
  autoCreatePr: boolean;
  openAsCursorGithubApp: boolean;
  skipReviewerRequest: boolean;
  autoBranch: boolean;
}

export interface CloudAgentListItem {
  id: string;
  name: string;
  status: string;
  source: CloudAgentSource;
  target: CloudAgentTarget;
  summary?: string;
  createdAt: string;
}

/** Strips internal `summary` before JSON responses for POST /v0/agents and GET /v0/agents/{id}. */
export function cloudAgentApiResponse(
  item: CloudAgentListItem,
): Omit<CloudAgentListItem, "summary"> {
  const { summary: _omit, ...rest } = item;
  return rest;
}

export interface CloudAgentListResponse {
  agents: CloudAgentListItem[];
  nextCursor?: string;
}

export interface CloudLaunchPromptImage {
  data: string;
  dimension: {
    width: number;
    height: number;
  };
}

/** POST /v0/agents/{id}/followup — [Cloud docs](https://cursor.com/docs/cloud-agent/api/endpoints#add-follow-up) */
export interface CloudFollowupRequest {
  prompt: {
    text: string;
    images?: CloudLaunchPromptImage[];
  };
}

/** POST /v0/agents/{id}/followup response */
export interface CloudFollowupPostResponse {
  id: string;
  /** True when the agent was busy or the queue already had items; prompt was stored for later. */
  queued: boolean;
  /** 1-based position in line when `queued` is true (includes this request). */
  queuePosition?: number;
}

export interface CloudLaunchRequest {
  prompt: {
    text: string;
    images?: CloudLaunchPromptImage[];
  };
  model?: string;
  source: {
    repository?: string;
    ref?: string;
    prUrl?: string;
  };
  target?: {
    autoCreatePr?: boolean;
    openAsCursorGithubApp?: boolean;
    skipReviewerRequest?: boolean;
    branchName?: string;
    autoBranch?: boolean;
  };
  webhook?: {
    url: string;
    secret?: string;
  };
}

/** GET /v0/agents/{id}/conversation — [Cloud docs](https://cursor.com/docs/cloud-agent/api/endpoints#agent-conversation) */

export interface CloudConversationMessage {
  id: string;
  type: "user_message" | "assistant_message";
  text: string;
}

export interface CloudConversationResponse {
  id: string;
  messages: CloudConversationMessage[];
}

export function toCloudConversationMessages(_sessionId: string, messages: ChatMessage[]): CloudConversationMessage[] {
  return messages.map((m, i) => ({
    id: `msg_${String(i + 1).padStart(3, "0")}`,
    type: m.role === "user" ? "user_message" : "assistant_message",
    text: m.content,
  }));
}

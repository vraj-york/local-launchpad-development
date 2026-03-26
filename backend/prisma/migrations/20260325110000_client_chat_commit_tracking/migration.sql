-- Track chat-message → commit SHA for client-link revert previews.
ALTER TABLE "FigmaConversion"
ADD COLUMN "pendingClientChatMessageId" INTEGER;

ALTER TABLE "ClientLinkChatMessage"
ADD COLUMN "appliedCommitSha" TEXT;

CREATE INDEX "ClientLinkChatMessage_projectId_releaseId_appliedCommitSha_idx"
ON "ClientLinkChatMessage"("projectId", "releaseId", "appliedCommitSha");

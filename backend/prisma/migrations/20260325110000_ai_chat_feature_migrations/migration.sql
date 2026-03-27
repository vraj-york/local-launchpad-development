-- AI chat feature migrations (squashed: client chat commit tracking, ChatHistory rename, mergedAt)

-- Track chat-message → commit SHA for client-link revert previews.
ALTER TABLE "FigmaConversion"
ADD COLUMN "pendingClientChatMessageId" INTEGER;

ALTER TABLE "ClientLinkChatMessage"
ADD COLUMN "appliedCommitSha" TEXT;

CREATE INDEX "ClientLinkChatMessage_projectId_releaseId_appliedCommitSha_idx"
ON "ClientLinkChatMessage"("projectId", "releaseId", "appliedCommitSha");

ALTER TABLE "ClientLinkChatMessage" RENAME TO "ChatHistory";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relkind = 'i'
      AND relname = 'ClientLinkChatMessage_projectId_releaseId_createdAt_idx'
  ) THEN
    ALTER INDEX "ClientLinkChatMessage_projectId_releaseId_createdAt_idx"
      RENAME TO "ChatHistory_projectId_releaseId_createdAt_idx";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relkind = 'i'
      AND relname = 'ClientLinkChatMessage_projectId_releaseId_appliedCommitSha_idx'
  ) THEN
    ALTER INDEX "ClientLinkChatMessage_projectId_releaseId_appliedCommitSha_idx"
      RENAME TO "ChatHistory_projectId_releaseId_appliedCommitSha_idx";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relkind = 'S'
      AND relname = 'ClientLinkChatMessage_id_seq'
  ) THEN
    ALTER SEQUENCE "ClientLinkChatMessage_id_seq"
      RENAME TO "ChatHistory_id_seq";
  END IF;
END $$;

ALTER TABLE "ChatHistory"
ADD COLUMN "mergedAt" TIMESTAMP(3);

/**
 * Deletes abandoned FeedbackRecordingSession rows: status uploading, never completed
 * (chunkCount still null), older than FEEDBACK_RECORDING_STALE_SESSION_HOURS (default 36).
 *
 * Invoked automatically after deploy: backend entrypoint.sh (Docker) and backend/deploy.sh (non-Docker).
 * Manual: npm run cron:cleanup-feedback-sessions. Optional crontab: scripts/cron-cleanup-stale-feedback-sessions.sh
 */
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { FEEDBACK_RECORDING_STALE_SESSION_HOURS_DEFAULT } from "../utils/feedbackRecording.constants.js";

function parseStaleHours() {
  const raw = process.env.FEEDBACK_RECORDING_STALE_SESSION_HOURS;
  if (raw == null || raw === "") {
    return FEEDBACK_RECORDING_STALE_SESSION_HOURS_DEFAULT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    console.error(
      "[cleanup-feedback-sessions] Invalid FEEDBACK_RECORDING_STALE_SESSION_HOURS; using default.",
    );
    return FEEDBACK_RECORDING_STALE_SESSION_HOURS_DEFAULT;
  }
  return n;
}

async function main() {
  const hours = parseStaleHours();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const result = await prisma.feedbackRecordingSession.deleteMany({
    where: {
      status: "uploading",
      chunkCount: null,
      createdAt: { lt: cutoff },
    },
  });

  console.log(
    `[cleanup-feedback-sessions] deleted ${result.count} stale session(s) (uploading, no complete, created before ${cutoff.toISOString()}, threshold ${hours}h)`,
  );
}

main()
  .catch((err) => {
    console.error("[cleanup-feedback-sessions]", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

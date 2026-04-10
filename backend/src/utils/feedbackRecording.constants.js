/** Max chunks (~33 min at 3s slice). */
export const FEEDBACK_RECORDING_MAX_CHUNKS = 660;

/** Per-chunk presigned PUT body size cap (bytes). */
export const FEEDBACK_RECORDING_MAX_CHUNK_BYTES = 20 * 1024 * 1024;

/** Presigned PUT TTL (seconds). */
export const FEEDBACK_RECORDING_PRESIGN_EXPIRES_SEC = 900;

/**
 * Default minimum age (hours) for abandoned sessions before the cleanup cron deletes them.
 * Sessions must still be `uploading` with no `complete` call (`chunkCount` null).
 * Override with env `FEEDBACK_RECORDING_STALE_SESSION_HOURS`.
 */
export const FEEDBACK_RECORDING_STALE_SESSION_HOURS_DEFAULT = 36;

export function feedbackRecordingKeyPrefix(sessionId) {
  return `feedback-recordings/${sessionId}`;
}

export function feedbackRecordingChunkObjectKey(sessionId, chunkIndex, ext) {
  const padded = String(chunkIndex).padStart(6, "0");
  return `${feedbackRecordingKeyPrefix(sessionId)}/chunk-${padded}.${ext}`;
}

export function feedbackRecordingFinalObjectKey(sessionId, ext) {
  return `${feedbackRecordingKeyPrefix(sessionId)}/final-merged.${ext}`;
}

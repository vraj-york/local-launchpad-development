# Feedback screen recording (S3 + FFmpeg + Jira)

## Overview

The feedback widget can upload **chunked screen recordings** to S3 using presigned PUT URLs, then a **separate worker** merges chunks with **ffmpeg** and attaches the final video to the Jira issue.

## Operations checklist

### 1. Database

Apply the Prisma migration that adds `FeedbackRecordingSession` and `FeedbackRecordingMergeJob`:

```bash
cd backend && npx prisma migrate deploy
```

### 2. S3 bucket CORS

Browser uploads use presigned `PUT` directly to S3. The bucket CORS configuration must allow:

- **Methods**: `PUT`, `GET`, `HEAD` (as needed)
- **Origins**: every origin that hosts the embedded feedback widget (your app domain and any customer sites that load the script)
- **Headers**: at least `Content-Type`

Example shape (adjust origins; do not use `*` if credentials are involved):

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["https://your-app.example.com"],
    "ExposeHeaders": ["ETag"]
  }
]
```

### 3. FFmpeg on the worker host

The merge worker shells out to `ffmpeg`. Install it on the same machine (or image) that runs `npm run worker:feedback-recording` (or the Docker Compose `feedback-recording-worker` service):

- macOS: `brew install ffmpeg`
- Debian/Ubuntu: `apt-get install ffmpeg`

### 4. Run the worker

Development:

```bash
cd backend && npm run worker:feedback-recording
```

Production (same host as the API, without Docker): run the worker in a separate terminal or a second systemd unit that executes `npm run worker:feedback-recording`.

**Docker Compose** (production-style stack in this repo):

- The backend image includes **ffmpeg** and a **`feedback-recording-worker`** service runs `node src/workers/feedbackRecordingMerge.worker.js` with the same **`DATABASE_URL`**, **`AWS_*`**, and **`OAUTH_TOKEN_ENCRYPTION_KEY`** as the API (see root `docker-compose.yml`).
- It uses **`worker-docker-entrypoint.sh`** only for the same `localhost` → `host.docker.internal` `DATABASE_URL` tweak as the main API entrypoint; it does **not** start nginx or run migrations (the `backend` service does migrations first).
- Start everything: `docker compose up -d` (or `--profile with-db` when using the bundled Postgres).

Ensure **only one** instance of this worker runs at a time (job claiming uses PostgreSQL row locks). Do not `docker compose scale feedback-recording-worker=2`.

### 5. Optional: S3 lifecycle

Consider expiring keys under `feedback-recordings/` after a few days for failed or abandoned sessions.

### 6. Stale `FeedbackRecordingSession` cleanup

Abandoned recordings can leave rows stuck in `uploading` with `chunkCount` null. The cleanup script deletes those older than a threshold (default **36 hours**).

**After each deploy (recommended — no crontab required):**

- **Docker Compose / EC2 with `docker compose up`:** The **backend** container **`entrypoint.sh`** runs `node src/scripts/cleanupStaleFeedbackRecordingSessions.js` once after migrations (before Node starts). Failures are logged and do not block startup.
- **`backend/deploy.sh` (non-Docker EC2):** Runs **`npm run cron:cleanup-feedback-sessions`** after DB migrate/push (non-fatal on error).

Disable in Docker only if needed: set **`SKIP_FEEDBACK_SESSION_CLEANUP=1`** on the backend service.

**Manual / optional daily cron** (only if you rarely redeploy and want extra runs):

```bash
cd backend && npm run cron:cleanup-feedback-sessions
```

Or: `backend/scripts/cron-cleanup-stale-feedback-sessions.sh` from crontab (see script header).

Override age (hours): **`FEEDBACK_RECORDING_STALE_SESSION_HOURS`** in the environment (minimum enforced in code: 1 hour).

## Environment

Uses the same variables as other S3 uploads: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, and `DATABASE_URL`.

## Limits (code)

- Max chunks: 660 (~22 minutes at 2s slices)
- Max chunk size for presign: 20 MB
- Presigned URL TTL: 15 minutes

## Troubleshooting: nothing in S3 / no video on Jira

1. **Browser Network tab** — After submit, you should see `POST .../chunk-upload-url` then `PUT` to `s3...amazonaws.com` with status **200**. If `PUT` is red, open it: **CORS** errors mean the bucket CORS rule must allow your widget origin and `PUT` + `Content-Type`. A **403** often means wrong `AWS_REGION` vs bucket region or signature mismatch.
2. **Chunks in S3 but no `FeedbackRecordingMergeJob`** — The widget must call `POST .../complete` and send `recordingSessionId` + `recordingChunkCount` on `POST /api/feedback`. Stopping the red record button finalizes the session and remembers the ids for submit; closing the widget without submitting discards that payload.
3. **S3 has objects but Jira has no video** — Run the merge worker (`npm run worker:feedback-recording` or the `feedback-recording-worker` Compose service). Check DB table `FeedbackRecordingMergeJob`: `failed` rows usually mean missing **ffmpeg** or S3 download errors; see worker logs.
4. **API logs** — On successful enqueue you should see `[feedback] Recording merge job enqueued <sessionId> <JIRA-KEY>`. If you see `[feedback] Recording merge enqueue error`, read the message (session validation, chunk count mismatch, etc.).

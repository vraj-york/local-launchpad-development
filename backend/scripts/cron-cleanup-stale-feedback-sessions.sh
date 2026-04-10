#!/usr/bin/env bash
# Optional: use only if you want scheduled runs in addition to post-deploy (entrypoint / deploy.sh).
# Example crontab (daily 4:00 server time):
#   0 4 * * * /path/to/project-management-platform/backend/scripts/cron-cleanup-stale-feedback-sessions.sh >>/var/log/feedback-session-cleanup.log 2>&1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec node src/scripts/cleanupStaleFeedbackRecordingSessions.js

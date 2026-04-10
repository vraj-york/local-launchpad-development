import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { execa } from "execa";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../lib/prisma.js";
import { s3 } from "../utils/uploadFileToS3.js";
import {
  addAttachmentToJiraIssue,
} from "../utils/jiraIntegration.js";
import {
  resolveJiraCredentialsFromProject,
  jiraIntegrationConfigFromResolved,
} from "../services/integrationCredential.service.js";
import {
  feedbackRecordingChunkObjectKey,
  feedbackRecordingFinalObjectKey,
} from "../utils/feedbackRecording.constants.js";

const POLL_MS = 4000;
const MAX_ATTEMPTS = 5;
const BUCKET = () => process.env.AWS_S3_BUCKET;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadS3ObjectToFile(key, destPath) {
  const out = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET(),
      Key: key,
    }),
  );
  if (!out.Body) {
    throw new Error(`Empty S3 body for ${key}`);
  }
  await pipeline(out.Body, createWriteStream(destPath));
}

async function resolveChunkLocalPath(sessionId, index, tmpDir) {
  const lastError = [];
  for (const ext of ["webm", "mp4"]) {
    const key = feedbackRecordingChunkObjectKey(sessionId, index, ext);
    const local = path.join(
      tmpDir,
      `part-${String(index).padStart(6, "0")}.${ext}`,
    );
    try {
      await downloadS3ObjectToFile(key, local);
      return { local, ext };
    } catch (err) {
      const code = err.Code || err.name;
      const status = err.$metadata?.httpStatusCode;
      if (code === "NoSuchKey" || status === 404) {
        lastError.push(err.message);
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Missing chunk ${index} for session ${sessionId}: ${lastError.join("; ")}`,
  );
}

async function tryFfmpegConcatCopy(listPath, outPath) {
  await execa(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath],
    { stdio: "pipe" },
  );
}

/**
 * Decode concat-listed segments and encode a single MP4. Required for WebM
 * chunks from MediaRecorder: `-c copy` concat often yields 0s duration or
 * only the first slice in players (Matroska cluster boundaries).
 */
async function transcodeSingleInputToMp4(inputPath, outPath) {
  try {
    await execa(
      "ffmpeg",
      [
        "-y",
        "-fflags",
        "+genpts",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { stdio: "pipe" },
    );
  } catch {
    await execa(
      "ffmpeg",
      [
        "-y",
        "-fflags",
        "+genpts",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { stdio: "pipe" },
    );
  }
}

async function tryFfmpegConcatReencodeMp4(listPath, outPath) {
  try {
    await execa(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { stdio: "pipe" },
    );
  } catch {
    await execa(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { stdio: "pipe" },
    );
  }
}

/**
 * MediaRecorder timeslice blobs are sequential Matroska clusters; they are meant
 * to be byte-appended — not opened as separate files (concat demuxer breaks).
 */
async function mergeWebmBinaryThenTranscode(parts, tmpDir) {
  const combined = path.join(tmpDir, "combined.webm");
  const fsp = fs.promises;
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p.ext !== "webm") {
      throw new Error(`Expected .webm parts for binary merge, got .${p.ext}`);
    }
    const buf = await fsp.readFile(p.local);
    if (i === 0) {
      await fsp.writeFile(combined, buf);
    } else {
      await fsp.appendFile(combined, buf);
    }
  }

  const outMp4 = path.join(tmpDir, "merged-out.mp4");
  await transcodeSingleInputToMp4(combined, outMp4);
  return { filePath: outMp4, ext: "mp4" };
}

async function mergeChunksToFile(sessionId, chunkCount, tmpDir) {
  const parts = [];
  let extHint = "webm";
  for (let i = 0; i < chunkCount; i += 1) {
    const { local, ext } = await resolveChunkLocalPath(sessionId, i, tmpDir);
    parts.push({ local, ext });
    if (i === 0) extHint = ext;
  }

  const listPath = path.join(tmpDir, "concat.txt");
  const lines = parts.map((p) => {
    const base = path.basename(p.local);
    return `file '${base.replace(/'/g, "'\\''")}'`;
  });
  fs.writeFileSync(listPath, `${lines.join("\n")}\n`, "utf8");

  if (extHint === "webm") {
    try {
      return await mergeWebmBinaryThenTranscode(parts, tmpDir);
    } catch (err) {
      console.error(
        "[feedback-recording-worker] WebM binary merge/transcode failed, trying concat demuxer:",
        err?.message,
      );
      const outMp4 = path.join(tmpDir, "merged-out.mp4");
      await tryFfmpegConcatReencodeMp4(listPath, outMp4);
      return { filePath: outMp4, ext: "mp4" };
    }
  }

  const outCopy = path.join(tmpDir, `merged-copy.${extHint}`);
  try {
    await tryFfmpegConcatCopy(listPath, outCopy);
    return { filePath: outCopy, ext: extHint };
  } catch {
    const outMp4 = path.join(tmpDir, "merged-out.mp4");
    await tryFfmpegConcatReencodeMp4(listPath, outMp4);
    return { filePath: outMp4, ext: "mp4" };
  }
}

async function uploadFinalVideo(sessionId, filePath, ext) {
  const key = feedbackRecordingFinalObjectKey(sessionId, ext);
  const body = fs.createReadStream(filePath);
  const contentType = ext === "mp4" ? "video/mp4" : "video/webm";
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentDisposition: "inline",
    }),
  );
  return key;
}

async function claimNextJob() {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id FROM "FeedbackRecordingMergeJob"
      WHERE status = 'pending'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (!rows?.length) {
      return null;
    }
    const id = rows[0].id;
    return tx.feedbackRecordingMergeJob.update({
      where: { id },
      data: {
        status: "processing",
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
  });
}

async function failJob(job, err, allowRetry) {
  const msg = err?.message || String(err);
  console.error(`[feedback-recording-worker] job ${job.id} failed:`, msg);
  await prisma.feedbackRecordingMergeJob.update({
    where: { id: job.id },
    data: {
      status: allowRetry ? "pending" : "failed",
      lastError: msg.slice(0, 4000),
      lockedAt: null,
    },
  });
  if (!allowRetry) {
    await prisma.feedbackRecordingSession.update({
      where: { id: job.sessionId },
      data: { status: "failed", error: msg.slice(0, 4000) },
    }).catch(() => {});
  }
}

async function succeedJob(job, sessionId, finalKey) {
  await prisma.feedbackRecordingMergeJob.update({
    where: { id: job.id },
    data: { status: "completed", lastError: null, lockedAt: null },
  });
  await prisma.feedbackRecordingSession.update({
    where: { id: sessionId },
    data: { status: "merged", finalS3Key: finalKey, error: null },
  });
}

async function processJob(job) {
  const session = await prisma.feedbackRecordingSession.findUnique({
    where: { id: job.sessionId },
  });
  if (!session || !session.chunkCount || session.chunkCount < 1) {
    throw new Error("Recording session missing or has no chunkCount.");
  }

  const project = await prisma.project.findUnique({
    where: { id: job.projectId },
    select: {
      createdById: true,
      jiraBaseUrl: true,
      jiraProjectKey: true,
      jiraApiToken: true,
      jiraUsername: true,
      jiraConnectionId: true,
      jiraIssueType: true,
    },
  });
  if (!project?.jiraBaseUrl || !project?.jiraProjectKey) {
    throw new Error("Project Jira configuration missing.");
  }

  const jc = await resolveJiraCredentialsFromProject(project);
  const jiraCfg = jiraIntegrationConfigFromResolved(jc, {
    jiraProjectKey: project.jiraProjectKey,
    jiraIssueType: project.jiraIssueType || "Task",
  });
  if (!jiraCfg) {
    throw new Error("Could not resolve Jira credentials.");
  }

  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "feedback-rec-"),
  );
  try {
    const { filePath, ext } = await mergeChunksToFile(
      job.sessionId,
      session.chunkCount,
      tmpDir,
    );
    const finalKey = await uploadFinalVideo(job.sessionId, filePath, ext);
    const attachName =
      ext === "mp4" ? "screen-recording.mp4" : "screen-recording.webm";
    const attachPath = path.join(tmpDir, attachName);
    fs.copyFileSync(filePath, attachPath);
    const attachResult = await addAttachmentToJiraIssue(
      job.jiraIssueKey,
      attachPath,
      jiraCfg,
    );
    if (!attachResult.success) {
      throw new Error(attachResult.error || "Jira video attachment failed.");
    }
    await succeedJob(job, job.sessionId, finalKey);
    console.log(
      `[feedback-recording-worker] job ${job.id} completed → ${job.jiraIssueKey}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runLoop() {
  if (!BUCKET()) {
    console.error("[feedback-recording-worker] AWS_S3_BUCKET is not set.");
    process.exit(1);
  }
  console.log("[feedback-recording-worker] started");
  for (;;) {
    try {
      const job = await claimNextJob();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      try {
        await processJob(job);
      } catch (err) {
        const allowRetry = job.attempts < MAX_ATTEMPTS;
        await failJob(job, err, allowRetry);
      }
    } catch (loopErr) {
      console.error("[feedback-recording-worker] loop error:", loopErr);
      await sleep(POLL_MS);
    }
  }
}

runLoop();

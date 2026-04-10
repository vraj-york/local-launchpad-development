/** Timeslice for MediaRecorder; also drives how often we presign + PUT to S3 during recording. */
const SLICE_MS = 2000;

function pickRecorderMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "video/webm";
}

function contentTypeHeaderForPresign(mimeType) {
  return String(mimeType || "video/webm").split(";")[0].trim();
}

/**
 * Creates a server session (POST) so the client can upload chunks later.
 * The widget normally creates the session inside {@link startChunkedScreenRecording}'s
 * `start()` after the display/mic stream is ready (avoids orphan rows if the user
 * cancels the picker). Use this only if you need a `sessionId` before recording.
 *
 * @param {string} apiUrl
 * @param {string|number} projectId
 * @param {string} clientEmail
 */
export async function createFeedbackRecordingSession(
  apiUrl,
  projectId,
  clientEmail,
) {
  return createSession(apiUrl, projectId, clientEmail);
}

/**
 * @param {string} apiUrl
 * @param {string|number} projectId
 * @param {string} clientEmail
 */
async function createSession(apiUrl, projectId, clientEmail) {
  const res = await fetch(`${apiUrl}/api/feedback/recording/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: String(projectId),
      clientEmail: String(clientEmail).trim().toLowerCase(),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Could not start screen recording session.");
  }
  return {
    sessionId: data.sessionId,
    sessionToken: data.sessionToken,
  };
}

async function presignChunk(
  apiUrl,
  sessionId,
  sessionToken,
  chunkIndex,
  mimeType,
) {
  const res = await fetch(
    `${apiUrl}/api/feedback/recording/sessions/${encodeURIComponent(sessionId)}/chunk-upload-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionToken,
        chunkIndex,
        contentType: contentTypeHeaderForPresign(mimeType),
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Could not get upload URL for recording.");
  }
  return data;
}

async function completeSession(apiUrl, sessionId, sessionToken, chunkCount) {
  const res = await fetch(
    `${apiUrl}/api/feedback/recording/sessions/${encodeURIComponent(sessionId)}/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionToken,
        chunkCount,
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Could not finalize screen recording.");
  }
}

/**
 * Starts chunked upload screen recording on an existing display-capture stream.
 * @param {{
 *   apiUrl: string;
 *   projectId: string|number;
 *   clientEmail: string;
 *   stream: MediaStream;
 *   existingSession?: { sessionId: string; sessionToken: string };
 * }} opts
 */
export function startChunkedScreenRecording({
  apiUrl,
  projectId,
  clientEmail,
  stream,
  existingSession,
}) {
  const mimeType = pickRecorderMimeType();
  let sessionId = null;
  let sessionToken = null;
  let recorder = null;
  let nextChunkIndex = 0;
  let uploadChain = Promise.resolve();

  const runUpload = async (chunkIndex, blob) => {
    const { uploadUrl, headers } = await presignChunk(
      apiUrl,
      sessionId,
      sessionToken,
      chunkIndex,
      mimeType,
    );
    const ct =
      (headers && headers["Content-Type"]) || contentTypeHeaderForPresign(mimeType);
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": ct },
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
    if (!putRes.ok) {
      const t = await putRes.text().catch(() => "");
      throw new Error(
        t.slice(0, 200) || `Chunk upload failed (${putRes.status})`,
      );
    }
  };

  return {
    mimeType,

    async start() {
      if (
        existingSession?.sessionId &&
        typeof existingSession.sessionToken === "string"
      ) {
        sessionId = existingSession.sessionId;
        sessionToken = existingSession.sessionToken;
      }
      try {
        recorder = new MediaRecorder(stream, { mimeType });
        if (!sessionId || !sessionToken) {
          const sess = await createSession(apiUrl, projectId, clientEmail);
          sessionId = sess.sessionId;
          sessionToken = sess.sessionToken;
        }
        recorder.ondataavailable = (ev) => {
          if (!ev.data || ev.data.size < 1) return;
          const idx = nextChunkIndex;
          nextChunkIndex += 1;
          const blob = ev.data;
          uploadChain = uploadChain.then(() => runUpload(idx, blob));
        };
        recorder.start(SLICE_MS);
        // Prompt an early first chunk so presign + S3 PUT appear soon after Record (not only on Stop).
        globalThis.setTimeout(() => {
          try {
            if (
              recorder &&
              recorder.state === "recording" &&
              typeof recorder.requestData === "function"
            ) {
              recorder.requestData();
            }
          } catch {
            /* ignore */
          }
        }, 400);
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        throw err;
      }
    },

    async stop() {
      try {
        if (!recorder) {
          return { sessionId: null, sessionToken: null, chunkCount: 0 };
        }
        if (recorder.state !== "inactive") {
          try {
            if (
              recorder.state === "recording" &&
              typeof recorder.requestData === "function"
            ) {
              recorder.requestData();
            }
          } catch {
            /* ignore */
          }
          await new Promise((resolve) => {
            recorder.addEventListener("stop", resolve, { once: true });
            recorder.stop();
          });
        }
        // Last dataavailable may be scheduled after "stop"; wait before draining the chain.
        await new Promise((r) => setTimeout(r, 150));
        await uploadChain;
        const chunkCount = nextChunkIndex;
        if (sessionId && sessionToken && chunkCount > 0) {
          await completeSession(apiUrl, sessionId, sessionToken, chunkCount);
        }
        return { sessionId, sessionToken, chunkCount };
      } finally {
        stream.getTracks().forEach((t) => t.stop());
      }
    },

    discard() {
      try {
        if (recorder && recorder.state !== "inactive") {
          recorder.ondataavailable = null;
          recorder.stop();
        }
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

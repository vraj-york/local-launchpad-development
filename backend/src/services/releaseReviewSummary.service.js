import { PrismaClient } from "@prisma/client";
import fetch from "node-fetch";

const prisma = new PrismaClient();

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEBOUNCE_MS = 60_000;

function getOpenAiKey() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

function getOpenAiModel() {
  const m = (process.env.OPENAI_MODEL || "").trim();
  return m || "gpt-4o-mini";
}

/**
 * @param {object} ctx
 * @param {string} ctx.projectName
 * @param {object} ctx.release
 * @param {string|null} [ctx.generationContext] — team instructions for the AI (DB or unsaved override)
 * @param {Array<{ title: string, description: string | null, type: string, status: string }>} ctx.roadmapItems
 * @param {Array<{ version: string, gitTag: string, isActive: boolean }>} ctx.versions
 */
function buildUserPrompt({
  projectName,
  release,
  generationContext,
  roadmapItems,
  versions,
}) {
  const lines = [];
  lines.push(`Project: ${projectName}`);
  lines.push(`Release name: ${release.name}`);
  if (release.description?.trim()) lines.push(`Release description: ${release.description.trim()}`);
  if (release.clientReleaseNote?.trim()) {
    lines.push(`Client-facing release note: ${release.clientReleaseNote.trim()}`);
  }
  if (release.actualReleaseNotes?.trim()) {
    lines.push(`Internal ship notes: ${release.actualReleaseNotes.trim()}`);
  }
  lines.push(`Release status: ${release.status}`);
  const genCtx =
    typeof generationContext === "string" && generationContext.trim()
      ? generationContext.trim()
      : null;
  if (genCtx) {
    lines.push("");
    lines.push("Team instructions for this checklist (follow closely):");
    lines.push(genCtx);
    lines.push("");
  }
  if (versions.length) {
    lines.push("Versions in this release:");
    for (const v of versions) {
      const tag = (v.gitTag || "").trim() || "(no tag)";
      lines.push(
        `  - ${v.version} (ref: ${tag})${v.isActive ? " [CURRENT LIVE BUILD]" : ""}`,
      );
    }
  } else {
    lines.push("No versions uploaded yet for this release.");
  }
  if (roadmapItems.length) {
    lines.push("Roadmap items linked to this release:");
    for (const r of roadmapItems) {
      const desc = r.description?.trim() ? ` — ${r.description.trim()}` : "";
      lines.push(`  - [${r.type}/${r.status}] ${r.title}${desc}`);
    }
  } else {
    lines.push("No roadmap items linked to this release.");
  }
  return lines.join("\n");
}

async function callOpenAi(userContent) {
  const key = getOpenAiKey();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const model = getOpenAiModel();
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You help client UAT testers. Given project and release context, write a concise checklist of what to review and what to prioritize. " +
            "If team instructions are provided, reflect them clearly in the checklist (scope, focus areas, out-of-scope). " +
            "Use short bullet points (markdown `- ` lines). Friendly, non-technical where possible. " +
            "Do not invent features not implied by the input. Stay under 220 words. No preamble.",
        },
        { role: "user", content: userContent },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data?.error?.message === "string"
        ? data.error.message
        : `OpenAI HTTP ${res.status}`;
    throw new Error(msg);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Empty response from OpenAI");
  }
  return text.trim();
}

/**
 * Regenerate and persist summary. Awaited for manual API; also used inside scheduler.
 * @param {number} releaseId
 * @param {{ force?: boolean, generationContextOverride?: string|null }} [options]
 * — When `generationContextOverride` is defined (including null), use it for the prompt instead of DB.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string }>}
 */
export async function regenerateClientReviewSummaryNow(releaseId, options = {}) {
  const force = Boolean(options.force);
  const generationContextOverride = options.generationContextOverride;
  const id = Number(releaseId);
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, error: "Invalid release id" };
  }

  if (!getOpenAiKey()) {
    return { ok: false, error: "OPENAI_API_KEY not set" };
  }

  const existing = await prisma.release.findUnique({
    where: { id },
    select: {
      clientReviewAiSummaryAt: true,
    },
  });
  if (!existing) {
    return { ok: false, error: "Release not found" };
  }

  if (
    !force &&
    existing.clientReviewAiSummaryAt &&
    Date.now() - new Date(existing.clientReviewAiSummaryAt).getTime() < DEBOUNCE_MS
  ) {
    return { ok: true, skipped: true };
  }

  const release = await prisma.release.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      name: true,
      description: true,
      clientReleaseNote: true,
      actualReleaseNotes: true,
      clientReviewAiGenerationContext: true,
      status: true,
      project: { select: { name: true } },
      versions: {
        orderBy: { createdAt: "desc" },
        select: { version: true, gitTag: true, isActive: true },
      },
    },
  });

  if (!release) {
    return { ok: false, error: "Release not found" };
  }

  const roadmapItems = await prisma.roadmapItem.findMany({
    where: { releaseId: id },
    select: { title: true, description: true, type: true, status: true },
    orderBy: { id: "asc" },
  });

  const generationContext =
    generationContextOverride !== undefined
      ? generationContextOverride
      : release.clientReviewAiGenerationContext?.trim() || null;

  const userPrompt = buildUserPrompt({
    projectName: release.project?.name || "Project",
    release,
    generationContext,
    roadmapItems,
    versions: release.versions || [],
  });

  try {
    const summary = await callOpenAi(userPrompt);
    await prisma.release.update({
      where: { id },
      data: {
        clientReviewAiSummary: summary,
        clientReviewAiSummaryAt: new Date(),
      },
    });
    return { ok: true };
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error("[releaseReviewSummary]", id, msg);
    return { ok: false, error: msg };
  }
}

/**
 * Fire-and-forget regeneration (does not block HTTP handlers).
 * @param {number} releaseId
 * @param {{ force?: boolean }} [options]
 */
export function scheduleRegenerateClientReviewSummary(releaseId, options = {}) {
  if (!getOpenAiKey()) return;
  void (async () => {
    try {
      await regenerateClientReviewSummaryNow(releaseId, options);
    } catch (e) {
      console.error("[releaseReviewSummary] schedule failed:", e?.message || e);
    }
  })();
}

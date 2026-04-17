import { z } from "zod";
import { normalizeFlexibleUrl } from "@/lib/flexible-url";
import { isValidPromptImageBase64 } from "@/lib/prompt-reference-images";

export const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const sessionId = z.string().regex(SESSION_ID_RE, "invalid sessionId");

export const chatRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  sessionId: sessionId.optional(),
  model: z
    .string()
    .max(128)
    .regex(/^[a-zA-Z0-9._/-]+$/, "invalid model")
    .optional(),
  mode: z.enum(["agent", "ask", "plan"]).optional(),
  workspace: z.string().max(512).optional(),
});

const promptImageSchema = z.object({
  data: z
    .string()
    .min(1, "prompt.images[].data is required")
    .refine(isValidPromptImageBase64, "prompt.images[].data must be valid base64 or a data: URL with base64 payload"),
  dimension: z.object({
    width: z.number().int().positive("prompt.images[].dimension.width must be > 0"),
    height: z.number().int().positive("prompt.images[].dimension.height must be > 0"),
  }),
});

/** Shared with POST /v0/agents (launch) and POST /v0/agents/{id}/followup */
export const cloudLaunchPromptSchema = z.object({
  text: z.string().min(1, "prompt.text is required"),
  images: z.array(promptImageSchema).max(5, "prompt.images supports max 5 images").optional(),
});

function optionalFlexibleUrlField(label: string) {
  return z.preprocess(
    (v: unknown) => {
      if (v === null || v === undefined) return undefined;
      if (typeof v !== "string") return v;
      const t = v.trim();
      return t === "" ? undefined : t;
    },
    z.union([
      z.undefined(),
      z
        .string()
        .min(1, `${label} must not be empty when provided`)
        .transform((s) => normalizeFlexibleUrl(s)),
    ]),
  );
}

const launchSourceSchema = z.object({
  repository: optionalFlexibleUrlField("source.repository"),
  ref: z.string().min(1).max(256).optional(),
  prUrl: optionalFlexibleUrlField("source.prUrl"),
}).superRefine((value, ctx) => {
  if (!value.prUrl && !value.repository) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "source.repository is required unless source.prUrl is provided",
    });
  }
});

const launchTargetSchema = z.object({
  autoCreatePr: z.boolean().optional(),
  openAsCursorGithubApp: z.boolean().optional(),
  skipReviewerRequest: z.boolean().optional(),
  branchName: z.string().min(1).max(256).optional(),
  autoBranch: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (!value.autoCreatePr && value.openAsCursorGithubApp) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "target.openAsCursorGithubApp requires target.autoCreatePr=true",
    });
  }
  if (!value.autoCreatePr && value.skipReviewerRequest) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "target.skipReviewerRequest requires target.autoCreatePr=true",
    });
  }
});

const launchWebhookSchema = z.object({
  url: z.string().url("webhook.url must be a valid URL"),
  secret: z.string().min(32, "webhook.secret must be at least 32 characters").optional(),
});

export const launchAgentSchema = z.object({
  prompt: cloudLaunchPromptSchema,
  model: z.string().min(1).max(128).optional(),
  source: launchSourceSchema,
  target: launchTargetSchema.optional(),
  webhook: launchWebhookSchema.optional(),
});

export const followupAgentSchema = z.object({
  prompt: cloudLaunchPromptSchema,
});

export const deleteSessionSchema = z.object({
  sessionId,
});

export const sessionIdParam = sessionId;

export function parseBody<T>(schema: z.ZodType<T>, data: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { data: result.data };
  const first = result.error.issues[0];
  return { error: first?.message ?? "Validation failed" };
}

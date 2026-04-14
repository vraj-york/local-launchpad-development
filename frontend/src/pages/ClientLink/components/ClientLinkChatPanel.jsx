import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clientLinkFetchAgentStatus,
  clientLinkFetchChatMessages,
  clientLinkFetchExecutionSummary,
  clientLinkRefreshLiveBuild,
  clientLinkRevertMerge,
  clientLinkSendFollowup,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  getClientLinkVerifiedEmail,
  isPlausibleClientLinkEmail,
  setClientLinkVerifiedEmail,
} from "@/lib/clientLinkVerifiedEmail";
import {
  ArrowUp,
  Check,
  Crosshair,
  ImagePlus,
  RefreshCw,
  SquareMousePointer,
  Undo2,
  User,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildOpeningTagSnippet,
  formatPickedElementForPrompt,
  parseContextBlockToInspectorCtx,
  splitFollowupWithElementContext,
} from "./ClientLinkPreviewPicker";
import {
  parseDataUrlParts,
  PREVIEW_REPLACE_IMAGE_MAX_BYTES,
} from "@/lib/previewImageReplace";
import { PreviewReplaceImageButton } from "./PreviewReplaceImageButton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import Lottie from "lottie-react";
import logo from "../../../assets/fevicon.png";
import websiteChangesAnimation from "../../../assets/animations/website-changes-animations.json";

/**
 * @param {File} file
 * @returns {Promise<{ previewDataUrl: string; mimeType: string; width: number; height: number }>}
 */
async function readImageFileAsChatStaging(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Drop a PNG, JPG, WebP, or other image file.");
  }
  if (file.size > PREVIEW_REPLACE_IMAGE_MAX_BYTES) {
    throw new Error("Image is too large (max 5 MB).");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const previewDataUrl = reader.result;
      if (typeof previewDataUrl !== "string") {
        reject(new Error("Could not read image."));
        return;
      }
      const img = new Image();
      img.onload = () => {
        resolve({
          previewDataUrl,
          mimeType: file.type || "image/png",
          width: img.naturalWidth || 512,
          height: img.naturalHeight || 512,
        });
      };
      img.onerror = () => reject(new Error("Could not read image."));
      img.src = previewDataUrl;
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

/** Matches backend `MAX_REFERENCE_IMAGES_PER_MESSAGE`. */
const MAX_STAGED_REFERENCE_IMAGES = 6;

/** Small inline thumb for chat / composer attachments; click opens full preview. */
const CHAT_ATTACHMENT_THUMB_CLASS =
  "h-9 w-9 shrink-0 rounded-md object-cover pointer-events-none";

const USER_BUBBLE_CLASS =
  "ml-6 rounded-lg rounded-br-xs bg-primary px-3 py-2 text-sm text-primary-foreground shadow-xs";
const SYSTEM_NEUTRAL_BUBBLE_CLASS =
  "mr-6 rounded-lg rounded-tl-xs border border-border bg-muted/60 px-3 py-2 text-sm text-foreground shadow-xs";
const SYSTEM_SUCCESS_BUBBLE_CLASS =
  "mr-6 rounded-lg rounded-tl-xs border border-emerald-500/35 bg-emerald-500/5 px-3 py-2 text-sm text-foreground shadow-xs";
const SYSTEM_ERROR_BUBBLE_CLASS =
  "mr-6 rounded-lg rounded-tl-xs border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground shadow-xs";

const CHAT_ACCESS_DENIED_USER_MESSAGE =
  "Your email is not allowed to use this chat feature.";

function InspectorBlock({ title, children }) {
  return (
    <div className="border-b border-zinc-800/90 py-2.5 first:pt-1 last:border-0 last:pb-1">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function ElementInspectorTooltipBody({ ctx }) {
  if (!ctx) {
    return (
      <p className="px-2 py-3 text-xs text-zinc-500">No element details.</p>
    );
  }

  const openSnippet = buildOpeningTagSnippet(ctx);
  const pathLine = ctx.domPath || ctx.selector || "—";

  const attrRows = [];
  if (ctx.className) attrRows.push(["class", ctx.className]);
  if (ctx.id) attrRows.push(["id", ctx.id]);
  if (ctx.role) attrRows.push(["role", ctx.role]);
  if (ctx.href) attrRows.push(["href", ctx.href]);
  if (ctx.ariaLabel) attrRows.push(["aria-label", ctx.ariaLabel]);
  if (ctx.dataTestId) attrRows.push(["data-testid", ctx.dataTestId]);
  if (ctx.dataComponent) attrRows.push(["data-component", ctx.dataComponent]);
  if (ctx.dataCy) attrRows.push(["data-cy", ctx.dataCy]);
  if (
    ctx.componentHint &&
    !ctx.dataTestId &&
    !ctx.dataComponent &&
    !ctx.dataCy
  ) {
    attrRows.push(["hint", ctx.componentHint]);
  }

  const computedEntries =
    ctx.computedStyles && typeof ctx.computedStyles === "object"
      ? Object.entries(ctx.computedStyles)
      : [];

  return (
    <div className="max-h-[min(70vh,32rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto px-3 py-2">
      <InspectorBlock title="Element">
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-sky-300">
          {openSnippet}
        </pre>
      </InspectorBlock>
      <InspectorBlock title="Path">
        <p className="break-all font-mono text-[11px] leading-snug text-zinc-300">
          {pathLine}
        </p>
        {ctx.path ? (
          <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
            URL: {ctx.path}
          </p>
        ) : null}
      </InspectorBlock>
      {ctx.textPreview ? (
        <InspectorBlock title="Visible text">
          <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-zinc-200">
            {ctx.textPreview}
          </p>
        </InspectorBlock>
      ) : null}
      <InspectorBlock title="Attributes">
        {attrRows.length === 0 ? (
          <p className="text-[11px] text-zinc-500">No attributes captured.</p>
        ) : (
          <dl className="space-y-2">
            {attrRows.map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[11px] text-sky-400">{k}:</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] text-zinc-200">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </InspectorBlock>
      <InspectorBlock title="Computed styles">
        {computedEntries.length === 0 ? (
          <p className="text-[11px] text-zinc-500">
            No snapshot (older pick or unavailable).
          </p>
        ) : (
          <dl className="space-y-2">
            {computedEntries.map(([k, v]) => (
              <div
                key={k}
                className="flex flex-wrap items-start gap-x-2 gap-y-1 font-mono text-[11px]"
              >
                <dt className="shrink-0 text-sky-400">{k}:</dt>
                <dd className="flex min-w-0 flex-1 items-center gap-2 text-zinc-200">
                  {(k === "color" || k === "background-color") && v ? (
                    <span
                      className="inline-block size-3.5 shrink-0 rounded-sm border border-zinc-600 bg-zinc-800"
                      style={{ backgroundColor: v }}
                      title={v}
                    />
                  ) : null}
                  <span className="min-w-0 break-all">{v}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </InspectorBlock>
    </div>
  );
}

/**
 * @param {{ tag: string, inspectorCtx?: object | null, contextBlock?: string, onRemove?: () => void, variant?: 'composer' | 'onPrimary', className?: string }} props
 */
function ElementContextChip({
  tag,
  inspectorCtx = null,
  contextBlock = "",
  onRemove,
  variant = "composer",
  className,
}) {
  const ctx =
    inspectorCtx ||
    (contextBlock ? parseContextBlockToInspectorCtx(contextBlock) : null);

  const chipVisual =
    variant === "onPrimary"
      ? "border border-white bg-emerald-500/15 text-white ring-1 ring-white/30"
      : "border-emerald-600/40 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-600/15 dark:border-emerald-500/45 dark:bg-emerald-950/55 dark:text-emerald-50 dark:ring-emerald-500/20";

  const iconClass = variant === "onPrimary" ? "text-white" : "text-primary";

  const monoClass =
    variant === "onPrimary"
      ? "text-white py-0.5"
      : "text-emerald-900 dark:text-emerald-100";

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex max-w-[min(100%,16rem)] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs",
            chipVisual,
            onRemove && "pr-0",
            className,
          )}
        >
          <SquareMousePointer
            className={cn("size-3.5 shrink-0", iconClass)}
            aria-hidden
          />
          <span className={cn("truncate font-mono text-xs", monoClass)}>
            &lt;{tag}&gt;
          </span>
          {onRemove ? (
            <button
              type="button"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-primary hover:bg-red-50 hover:text-red-500 dark:text-emerald-200/80 dark:hover:bg-emerald-500/20 dark:hover:text-white"
              aria-label="Remove selected element"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={8}
        className="border border-zinc-700 bg-zinc-950 p-0 text-zinc-100 shadow-2xl"
      >
        <ElementInspectorTooltipBody ctx={ctx} />
      </TooltipContent>
    </Tooltip>
  );
}

function extractChatHttpErrorMessage(err) {
  return err?.response?.data?.error || err?.error || err?.message || "";
}

/** Cursor may return errors such as "Unauthorized request.: Follow-up blocked." */
function mapChatSendErrorForUser(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  const lower = s.toLowerCase();
  if (/follow[- ]?up\s*blocked/.test(lower)) {
    return CHAT_ACCESS_DENIED_USER_MESSAGE;
  }
  if (/\bunauthorized\b/.test(lower) && /\bblocked\b/.test(lower)) {
    return CHAT_ACCESS_DENIED_USER_MESSAGE;
  }
  return s;
}

function isCursorAgentSuccessTerminal(status) {
  if (status == null || status === "") return false;
  const u = String(status).trim().toUpperCase().replace(/\s+/g, "_");
  return (
    u === "FINISHED" ||
    u === "COMPLETED" ||
    u === "COMPLETE" ||
    u === "SUCCEEDED" ||
    u === "SUCCESS" ||
    u === "DONE"
  );
}

function UserMessageAttachmentThumbs({ urls, onOpen }) {
  const list = Array.isArray(urls)
    ? urls.filter((u) => typeof u === "string" && u.trim())
    : [];
  if (!list.length) return null;
  return (
    <div className="mb-2 flex w-full flex-wrap justify-start gap-1.5">
      {list.map((url, i) => (
        <button
          key={`att-${i}`}
          type="button"
          className="overflow-hidden rounded-lg border border-white/25 bg-white/10 p-0.5 shadow-sm ring-1 ring-white/20 cursor-pointer transition hover:bg-white/15 hover:ring-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label={`View attached image ${i + 1} of ${list.length}`}
          onClick={() => onOpen?.(url)}
        >
          <img
            src={url}
            alt=""
            className={CHAT_ATTACHMENT_THUMB_CLASS}
            draggable={false}
          />
        </button>
      ))}
    </div>
  );
}

const ChatMessageRow = React.memo(function ChatMessageRow({
  msg,
  index,
  chatSending,
  chatPolling,
  chatHistoryLoading,
  revertLoadingKey,
  chatMayMutate,
  onRequestRevertConfirm,
  onOpenImagePreview,
}) {
  const rowKey = msg.id ?? msg.key ?? null;
  const isMerged = Boolean(msg?.isMerged);
  const isReverted = Boolean(msg?.isReverted);
  const isRevertBusy = revertLoadingKey === rowKey;
  const disableRevert =
    !chatMayMutate ||
    !isMerged ||
    isReverted ||
    chatSending ||
    chatPolling ||
    chatHistoryLoading ||
    revertLoadingKey != null;

  const systemTone = msg.role === "system" ? msg.tone || "neutral" : null;
  const systemClass =
    systemTone === "error"
      ? SYSTEM_ERROR_BUBBLE_CLASS
      : systemTone === "success"
        ? SYSTEM_SUCCESS_BUBBLE_CLASS
        : SYSTEM_NEUTRAL_BUBBLE_CLASS;

  const mergedAtText =
    isMerged && msg?.mergedAt
      ? new Date(msg.mergedAt).toLocaleString([], {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const elementSplit =
    msg.role === "user" ? splitFollowupWithElementContext(msg.text) : null;

  const attachmentUrls = useMemo(() => {
    const u = msg?.attachmentPreviewUrls;
    if (Array.isArray(u) && u.length) {
      return u.filter((x) => typeof x === "string" && x.trim());
    }
    if (msg?.attachmentPreviewUrl) return [msg.attachmentPreviewUrl];
    return [];
  }, [msg?.attachmentPreviewUrls, msg?.attachmentPreviewUrl]);

  return (
    <div
      key={msg.id ?? msg.key ?? `m-${index}`}
      className={msg.role === "user" ? USER_BUBBLE_CLASS : systemClass}
    >
      {elementSplit ? (
        <div className="flex w-full flex-col items-stretch gap-2.5">
          <div className="flex w-full justify-start">
            <ElementContextChip
              tag={elementSplit.tag}
              contextBlock={elementSplit.contextBlock}
              variant="onPrimary"
            />
          </div>
          {attachmentUrls.length ? (
            <UserMessageAttachmentThumbs
              urls={attachmentUrls}
              onOpen={onOpenImagePreview}
            />
          ) : null}
          <p className="w-full whitespace-pre-wrap break-words text-sm leading-relaxed">
            {elementSplit.userText}
          </p>
        </div>
      ) : (
        <>
          {msg.role === "user" && attachmentUrls.length ? (
            <UserMessageAttachmentThumbs
              urls={attachmentUrls}
              onOpen={onOpenImagePreview}
            />
          ) : null}
          {msg.text}
        </>
      )}
      {msg.role === "user" && msg.appliedCommitSha ? (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {isMerged ? (
            <span className="text-[11px] font-medium text-white/90">
              {isReverted
                ? "Reverted"
                : `${mergedAtText ? ` ${mergedAtText}` : ""}`}
            </span>
          ) : null}
          {isMerged && !isReverted ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disableRevert}
              className="h-7 rounded-lg border border-white/40 bg-white/15 px-2 text-[11px] font-semibold text-white hover:bg-white/25 disabled:text-white"
              onClick={() => onRequestRevertConfirm?.(msg)}
            >
              {isRevertBusy ? (
                <span className="flex items-center gap-1">
                  <Spinner className="size-3" />
                  Reverting…
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Undo2 className="size-3" />
                  Revert
                </span>
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export const ClientLinkChatPanel = React.memo(function ClientLinkChatPanel({
  projectSlug,
  scratchPrompt = null,
  /** When set, scratch prompt is only shown for chat on this release (project’s first / oldest release). */
  firstReleaseId = null,
  effectiveChatReleaseId,
  isLocked,
  isOpen,
  onProjectReloadQuiet,
  onResetPreview,
  onCloseChat,
  pickedElementContext = null,
  onPickedElementContextChange = () => {},
  visualPickMode = false,
  onVisualPickModeChange = () => {},
  previewIframeAccessible = null,
  previewIframeRef = null,
  onPreviewReplaceImageResult = () => {},
  stagedChatReplacementImage = null,
  onStagedChatReplacementImageChange = () => {},
  stagedChatReferenceImages = [],
  onStagedChatReferenceImagesChange = () => {},
  onReplacementStagedForRepo = () => {},
}) {
  const [chatInput, setChatInput] = useState("");
  const [composerDragOver, setComposerDragOver] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatSending, setChatSending] = useState(false);
  const [chatPolling, setChatPolling] = useState(false);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [revertLoadingKey, setRevertLoadingKey] = useState(null);
  const [refreshBuildBusy, setRefreshBuildBusy] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [revertPendingMsg, setRevertPendingMsg] = useState(null);
  const [verifyBump, setVerifyBump] = useState(0);
  const [panelEmailInput, setPanelEmailInput] = useState("");
  const [gateInlineError, setGateInlineError] = useState("");
  const [composerEmailEditorOpen, setComposerEmailEditorOpen] = useState(false);
  const [composerEmailDraft, setComposerEmailDraft] = useState("");
  const [composerEmailError, setComposerEmailError] = useState("");
  const [releaseAgentBusy, setReleaseAgentBusy] = useState(false);
  const [chatImagePreviewUrl, setChatImagePreviewUrl] = useState(null);

  const chatImageFileInputRef = useRef(null);
  const lastAgentSnapshotRef = useRef({
    releaseId: null,
    status: null,
    activity: null,
  });
  const settlePollLockRef = useRef(false);
  const busyAutoPollStartedRef = useRef(false);

  const openChatImagePreview = useCallback((url) => {
    const u = typeof url === "string" ? url.trim() : "";
    if (u) setChatImagePreviewUrl(u);
  }, []);

  const identityEmail = useMemo(
    () => getClientLinkVerifiedEmail(),
    [verifyBump, isOpen],
  );
  const identityLooksValid =
    Boolean(identityEmail) && isPlausibleClientLinkEmail(identityEmail);
  const showMainChatUi = identityLooksValid;

  const canViewChat =
    Boolean(projectSlug?.trim()) && effectiveChatReleaseId != null;
  const canMutateChat = canViewChat && !isLocked && identityLooksValid;
  const composerDisabled =
    !canMutateChat ||
    chatSending ||
    chatPolling ||
    chatHistoryLoading ||
    releaseAgentBusy;

  const scratchTrim = useMemo(() => {
    return typeof scratchPrompt === "string" ? scratchPrompt.trim() : "";
  }, [scratchPrompt]);

  const scratchPromptAppliesToThisRelease = useMemo(() => {
    if (firstReleaseId == null || effectiveChatReleaseId == null) return false;
    return Number(firstReleaseId) === Number(effectiveChatReleaseId);
  }, [firstReleaseId, effectiveChatReleaseId]);

  /** Scratch prompt from project settings shown first only on the first (oldest) release; deduped if it matches the first stored user message. */
  const displayMessages = useMemo(() => {
    if (!scratchTrim || !scratchPromptAppliesToThisRelease) return chatMessages;
    const firstUser = chatMessages.find((m) => m?.role === "user");
    const firstText =
      typeof firstUser?.text === "string" ? firstUser.text.trim() : "";
    if (firstText === scratchTrim) return chatMessages;
    return [
      {
        role: "user",
        key: "client-link-scratch-prompt",
        text: scratchTrim,
        isScratchPrompt: true,
      },
      ...chatMessages,
    ];
  }, [chatMessages, scratchTrim, scratchPromptAppliesToThisRelease]);

  /** Checkout release tag, build, deploy — then refresh project JSON quietly (no full-page loader) and bust iframe cache. */
  const runTagBuildAndRefreshUi = useCallback(async () => {
    if (!projectSlug?.trim() || effectiveChatReleaseId == null) {
      throw new Error("Missing release or project.");
    }
    const email = identityEmail?.trim();
    if (!email || !isPlausibleClientLinkEmail(email)) {
      throw new Error("Client email is not verified.");
    }
    await clientLinkRefreshLiveBuild(
      projectSlug,
      Number(effectiveChatReleaseId),
      email,
    );
    await onProjectReloadQuiet?.();
    onResetPreview?.();
  }, [
    effectiveChatReleaseId,
    identityEmail,
    onProjectReloadQuiet,
    onResetPreview,
    projectSlug,
  ]);

  const handleRefreshLiveBuild = useCallback(async () => {
    if (
      !canMutateChat ||
      effectiveChatReleaseId == null ||
      !projectSlug?.trim()
    ) {
      return;
    }
    setRefreshBuildBusy(true);
    try {
      await runTagBuildAndRefreshUi();
      toast.success("Preview refreshed from the latest tag.");
    } catch (e) {
      const raw = extractChatHttpErrorMessage(e);
      toast.error(raw || "Could not refresh the preview.");
    } finally {
      setRefreshBuildBusy(false);
    }
  }, [
    canMutateChat,
    effectiveChatReleaseId,
    projectSlug,
    runTagBuildAndRefreshUi,
  ]);

  const visualPickSupported = previewIframeAccessible === true;
  const visualPickDisabledReason =
    previewIframeAccessible === false
      ? "Visual pick needs a same-origin preview (for example local dev with the /iframe-preview/ proxy). Cross-origin previews cannot be inspected from the browser."
      : previewIframeAccessible === null
        ? "Loading preview…"
        : "";

  const handleToggleVisualPick = useCallback(() => {
    if (!visualPickSupported || !canMutateChat) return;
    onVisualPickModeChange(!visualPickMode);
  }, [
    visualPickSupported,
    canMutateChat,
    visualPickMode,
    onVisualPickModeChange,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const s = getClientLinkVerifiedEmail();
    setPanelEmailInput(s && isPlausibleClientLinkEmail(s) ? s : "");
    setGateInlineError("");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setComposerEmailEditorOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !showMainChatUi || composerEmailEditorOpen) return;
    const s = getClientLinkVerifiedEmail();
    setComposerEmailDraft(s && isPlausibleClientLinkEmail(s) ? s : "");
    setComposerEmailError("");
  }, [isOpen, showMainChatUi, verifyBump, composerEmailEditorOpen]);

  const toggleComposerEmailEditor = useCallback(() => {
    setComposerEmailEditorOpen((open) => {
      const next = !open;
      if (next) {
        const s = getClientLinkVerifiedEmail();
        setComposerEmailDraft(s && isPlausibleClientLinkEmail(s) ? s : "");
        setComposerEmailError("");
      }
      return next;
    });
  }, []);

  const handleContinueEmail = useCallback(() => {
    const email = panelEmailInput.trim().toLowerCase();
    if (!isPlausibleClientLinkEmail(email)) {
      setGateInlineError("Please enter a valid email address.");
      return;
    }
    setClientLinkVerifiedEmail(email);
    setGateInlineError("");
    setVerifyBump((b) => b + 1);
  }, [panelEmailInput]);

  const addSystemMessageOnce = useCallback((msgKey, text, tone = "neutral") => {
    setChatMessages((prev) => {
      const dup = prev.some((m) => m?.role === "system" && m?.key === msgKey);
      if (dup) return prev;
      return [...prev, { role: "system", key: msgKey, tone, text }];
    });
  }, []);

  const mapChatRows = useCallback(
    (rows = []) =>
      rows.map((row) => ({
        id: row.id,
        role: row.role,
        text: row.text,
        key: `db:${row.id}`,
        appliedCommitSha: row.appliedCommitSha || null,
        isMerged: Boolean(row.isMerged),
        mergedAt: row.mergedAt || null,
        revertedAt: row.revertedAt || null,
        isReverted: Boolean(row.isReverted),
        revertCommitSha: row.revertCommitSha || null,
        figmaConversionId: row.figmaConversionId ?? null,
        attachmentPreviewUrls: (() => {
          const arr = row.attachmentImageUrls;
          if (Array.isArray(arr) && arr.length) {
            return arr.filter((u) => typeof u === "string" && u.trim());
          }
          return [];
        })(),
        attachmentPreviewUrl:
          (Array.isArray(row.attachmentImageUrls) && row.attachmentImageUrls[0]) ||
          row.attachmentPreviewUrl ||
          null,
      })),
    [],
  );

  const refreshChatMessages = useCallback(
    async (rid = effectiveChatReleaseId) => {
      if (!projectSlug?.trim() || rid == null) return [];
      const data = await clientLinkFetchChatMessages(projectSlug, rid);
      const rows = mapChatRows(data?.messages ?? []);
      setChatMessages(rows);
      return rows;
    },
    [effectiveChatReleaseId, mapChatRows, projectSlug],
  );

  const handleSaveComposerEmail = useCallback(() => {
    const email = composerEmailDraft.trim().toLowerCase();
    if (!isPlausibleClientLinkEmail(email)) {
      setComposerEmailError("Please enter a valid email address.");
      return;
    }
    const current = (getClientLinkVerifiedEmail() || "").trim().toLowerCase();
    if (current === email) {
      setComposerEmailError("");
      setComposerEmailEditorOpen(false);
      return;
    }
    setClientLinkVerifiedEmail(email);
    setComposerEmailError("");
    setVerifyBump((b) => b + 1);
    void refreshChatMessages();
    setComposerEmailEditorOpen(false);
  }, [composerEmailDraft, refreshChatMessages]);

  const waitForClientLinkAutoMerge = useCallback(async () => {
    if (!projectSlug?.trim() || effectiveChatReleaseId == null) return;
    const rid = Number(effectiveChatReleaseId);
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const rows = await refreshChatMessages(rid);
      const latestUser = [...rows].reverse().find((m) => m?.role === "user");
      if (
        latestUser?.isMerged &&
        typeof latestUser?.appliedCommitSha === "string" &&
        latestUser.appliedCommitSha.trim()
      ) {
        return;
      }
      try {
        const st = await clientLinkFetchAgentStatus(projectSlug, rid);
        if (
          !st?.mergeConfirmationPending &&
          !st?.awaitingLaunchpadConfirmation
        ) {
          await refreshChatMessages(rid);
          return;
        }
      } catch {
        /* ignore */
      }
    }
  }, [effectiveChatReleaseId, projectSlug, refreshChatMessages]);

  const pollUntilAgentSettles = useCallback(async () => {
    if (!projectSlug?.trim() || effectiveChatReleaseId == null) return;
    if (settlePollLockRef.current) return;
    settlePollLockRef.current = true;
    setChatPolling(true);
    const start = Date.now();
    const maxMs = 15 * 60 * 1000;

    try {
      while (Date.now() - start < maxMs) {
        const st = await clientLinkFetchAgentStatus(
          projectSlug,
          effectiveChatReleaseId,
        );
        const raw = st?.status
          ? String(st.status).trim().toUpperCase().replace(/\s+/g, "_")
          : "";
        const activity =
          st?.activity && typeof st.activity === "string"
            ? st.activity.trim()
            : "";

        const last = lastAgentSnapshotRef.current;
        if (
          last.releaseId !== effectiveChatReleaseId ||
          last.status !== raw ||
          last.activity !== activity
        ) {
          if (raw) {
            addSystemMessageOnce(
              `status:${effectiveChatReleaseId}:${raw}`,
              activity
                ? `Agent status: ${raw} - ${activity}`
                : `Agent status: ${raw}`,
              "neutral",
            );
          } else if (activity) {
            addSystemMessageOnce(
              `activity:${effectiveChatReleaseId}:${activity}`,
              `Agent activity: ${activity}`,
              "neutral",
            );
          }
          lastAgentSnapshotRef.current = {
            releaseId: effectiveChatReleaseId,
            status: raw || null,
            activity: activity || null,
          };
        }

        if (
          isCursorAgentSuccessTerminal(raw) ||
          raw === "FAILED" ||
          raw.includes("FAIL") ||
          raw === "ERROR"
        ) {
          if (isCursorAgentSuccessTerminal(raw)) {
            const deferStyle =
              Boolean(st?.mergeConfirmationPending) ||
              Boolean(st?.awaitingLaunchpadConfirmation) ||
              Boolean(st?.deferLaunchpadMerge);
            if (deferStyle) {
              await refreshChatMessages(effectiveChatReleaseId);
              await waitForClientLinkAutoMerge();
              setChatMessages((m) => [
                ...m,
                {
                  role: "system",
                  tone: "success",
                  key: `merged-live:${effectiveChatReleaseId}:${Date.now()}`,
                  text: "Changes merged to launchpad. Rebuilding preview from tag…",
                },
              ]);
              try {
                await runTagBuildAndRefreshUi();
              } catch (e) {
                toast.error(
                  extractChatHttpErrorMessage(e) || "Preview rebuild failed.",
                );
              }
              await refreshChatMessages(effectiveChatReleaseId);
              return;
            }

            setChatMessages((m) => [
              ...m,
              {
                role: "system",
                tone: "success",
                key: `applied:${effectiveChatReleaseId}:${Date.now()}`,
                text: "Changes applied. Rebuilding preview from tag...",
              },
            ]);
            try {
              await runTagBuildAndRefreshUi();
            } catch (e) {
              toast.error(
                extractChatHttpErrorMessage(e) || "Preview rebuild failed.",
              );
            }

            try {
              const sum = await clientLinkFetchExecutionSummary(
                projectSlug,
                effectiveChatReleaseId,
              );
              if (sum?.pendingMergeConfirmation) {
                await waitForClientLinkAutoMerge();
                setChatMessages((m) => [
                  ...m,
                  {
                    role: "system",
                    tone: "success",
                    key: `merged-live2:${effectiveChatReleaseId}:${Date.now()}`,
                    text: "Changes merged to launchpad. Rebuilding preview from tag…",
                  },
                ]);
                try {
                  await runTagBuildAndRefreshUi();
                } catch (e) {
                  toast.error(
                    extractChatHttpErrorMessage(e) || "Preview rebuild failed.",
                  );
                }
                await refreshChatMessages(effectiveChatReleaseId);
                return;
              }
            } catch {
              /* ignore */
            }
          } else {
            setChatMessages((m) => [
              ...m,
              {
                role: "system",
                tone: "error",
                text: `Agent status: ${raw}. Check server logs if this persists.`,
              },
            ]);
            toast.error(`Agent ended with status: ${raw}`);
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      toast.message(
        "Still processing - you can close this panel and refresh the page later.",
      );
    } catch (e) {
      toast.error(e?.error || e?.message || "Status check failed");
    } finally {
      settlePollLockRef.current = false;
      setChatPolling(false);
    }
  }, [
    addSystemMessageOnce,
    effectiveChatReleaseId,
    projectSlug,
    refreshChatMessages,
    runTagBuildAndRefreshUi,
    waitForClientLinkAutoMerge,
  ]);

  const appendReferenceStagingFromFiles = useCallback(
    async (fileList) => {
      if (composerDisabled) return;
      const files = Array.from(fileList || []).filter((f) =>
        f?.type?.startsWith("image/"),
      );
      for (const file of files) {
        let wasFull = false;
        let appended = false;
        try {
          const staged = await readImageFileAsChatStaging(file);
          onStagedChatReferenceImagesChange((prev) => {
            const p = Array.isArray(prev) ? prev : [];
            if (p.length >= MAX_STAGED_REFERENCE_IMAGES) {
              wasFull = true;
              return p;
            }
            appended = true;
            return [...p, staged];
          });
        } catch (err) {
          toast.error(err?.message || "Could not attach image.");
        }
        if (wasFull) {
          toast.error(
            `At most ${MAX_STAGED_REFERENCE_IMAGES} reference images per message.`,
          );
          break;
        }
        if (appended) onStagedChatReplacementImageChange(null);
      }
    },
    [
      composerDisabled,
      onStagedChatReferenceImagesChange,
      onStagedChatReplacementImageChange,
    ],
  );

  const handleComposerDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setComposerDragOver(false);
      if (composerDisabled) return;
      const files = Array.from(e.dataTransfer?.files || []).filter((f) =>
        f.type?.startsWith("image/"),
      );
      if (files.length) await appendReferenceStagingFromFiles(files);
    },
    [appendReferenceStagingFromFiles, composerDisabled],
  );

  const handleChatImageFileChange = useCallback(
    (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      void appendReferenceStagingFromFiles(files);
    },
    [appendReferenceStagingFromFiles],
  );

  const handleSendChat = useCallback(async () => {
    const replacementPayload =
      stagedChatReplacementImage &&
      pickedElementContext?.selector &&
      stagedChatReplacementImage.selector === pickedElementContext.selector
        ? (() => {
            const raw = stagedChatReplacementImage.previewDataUrl;
            const parts =
              typeof raw === "string" ? parseDataUrlParts(raw) : null;
            if (!parts?.base64) return null;
            return {
              data: parts.base64,
              mimeType:
                stagedChatReplacementImage.mimeType ||
                parts.mimeType ||
                "image/png",
              width: stagedChatReplacementImage.width,
              height: stagedChatReplacementImage.height,
            };
          })()
        : null;

    const refList = Array.isArray(stagedChatReferenceImages)
      ? stagedChatReferenceImages
      : [];
    const referencePayloads =
      !replacementPayload && refList.length
        ? refList
            .map((img) => {
              const raw = img?.previewDataUrl;
              const parts = typeof raw === "string" ? parseDataUrlParts(raw) : null;
              if (!parts?.base64) return null;
              return {
                data: parts.base64,
                mimeType: img.mimeType || parts.mimeType || "image/png",
                width: img.width,
                height: img.height,
              };
            })
            .filter(Boolean)
        : null;

    if (replacementPayload && refList.length) {
      toast.error(
        "Remove the design reference or the element replacement image — only one attachment per message.",
      );
      return;
    }

    if (
      !replacementPayload &&
      refList.length &&
      (!referencePayloads || !referencePayloads.length)
    ) {
      toast.error("Could not read one or more attached images.");
      return;
    }

    let userPart = chatInput.trim();
    if (
      !userPart &&
      replacementPayload &&
      pickedElementContext?.replacementKind
    ) {
      userPart =
        "Replace the selected asset with the attached reference image. Save it under src/assets/ (e.g. src/assets/images/) and update imports or references in code.";
    }
    if (referencePayloads?.length && !userPart.trim()) {
      toast.error(
        "Add a message describing what you want for the attached image(s).",
      );
      return;
    }
    if (!userPart && !replacementPayload && !referencePayloads?.length) {
      toast.error("Enter a message or attach an image.");
      return;
    }
    if (!projectSlug?.trim()) {
      toast.error("Enter a message.");
      return;
    }
    if (effectiveChatReleaseId == null) {
      toast.error("Select a version above so we know which release to update.");
      return;
    }
    if (isLocked) {
      toast.error("This release is locked.");
      return;
    }

    const text = pickedElementContext
      ? `${formatPickedElementForPrompt(pickedElementContext)}\n\n${userPart}`
      : userPart;

    const attachmentPreviewUrls =
      replacementPayload && stagedChatReplacementImage?.previewDataUrl
        ? null
        : referencePayloads?.length
          ? refList.map((i) => i?.previewDataUrl).filter(Boolean)
          : null;

    const rid = Number(effectiveChatReleaseId);
    setChatSending(true);
    try {
      setChatMessages((m) => [
        ...m,
        {
          role: "user",
          text,
          ...(replacementPayload && stagedChatReplacementImage?.previewDataUrl
            ? {
                attachmentPreviewUrl:
                  stagedChatReplacementImage.previewDataUrl,
              }
            : attachmentPreviewUrls?.length
              ? {
                  attachmentPreviewUrls,
                  attachmentPreviewUrl: attachmentPreviewUrls[0],
                }
              : {}),
        },
      ]);
      setChatInput("");
      onPickedElementContextChange(null);
      onStagedChatReplacementImageChange(null);
      onStagedChatReferenceImagesChange([]);
      await clientLinkSendFollowup(
        projectSlug,
        rid,
        text,
        identityEmail,
        replacementPayload,
        !replacementPayload && referencePayloads?.length
          ? referencePayloads
          : null,
      );
      lastAgentSnapshotRef.current = {
        releaseId: rid,
        status: null,
        activity: null,
      };
      setChatMessages((m) => [
        ...m,
        {
          role: "system",
          tone: "neutral",
          text: "Request sent. Applying changes on the server...",
        },
      ]);
      void pollUntilAgentSettles();
    } catch (e) {
      const httpStatus = e?.response?.status;
      const errCode = e?.response?.data?.code;
      if (httpStatus === 409 || errCode === "CHAT_AGENT_BUSY") {
        setReleaseAgentBusy(true);
        try {
          await refreshChatMessages(effectiveChatReleaseId);
        } catch {
          /* ignore */
        }
        toast.error(
          extractChatHttpErrorMessage(e) ||
            "Another stakeholder is using the AI agent for this version. Please wait.",
        );
      } else {
        const rawMsg = extractChatHttpErrorMessage(e);
        const mapped = mapChatSendErrorForUser(rawMsg);
        const display = mapped || rawMsg || "Failed to send";
        toast.error(display);
        setChatMessages((m) => [
          ...m,
          {
            role: "system",
            tone: "error",
            text: display,
          },
        ]);
      }
    } finally {
      setChatSending(false);
    }
  }, [
    chatInput,
    effectiveChatReleaseId,
    identityEmail,
    isLocked,
    onPickedElementContextChange,
    onStagedChatReferenceImagesChange,
    onStagedChatReplacementImageChange,
    pickedElementContext,
    pollUntilAgentSettles,
    projectSlug,
    refreshChatMessages,
    stagedChatReferenceImages,
    stagedChatReplacementImage,
  ]);

  const handleRevertMergedMessage = useCallback(
    async (msg) => {
      if (!projectSlug?.trim() || effectiveChatReleaseId == null) return;
      const mid = Number(msg?.id);
      if (!Number.isInteger(mid) || mid < 1) {
        toast.error("Invalid message.");
        return;
      }
      const key = msg.id ?? msg.key ?? mid;
      setRevertLoadingKey(key);
      try {
        await clientLinkRevertMerge(
          projectSlug,
          effectiveChatReleaseId,
          mid,
          identityEmail,
        );
        toast.success("Reverted to this message.");
        try {
          await runTagBuildAndRefreshUi();
        } catch (e) {
          toast.error(
            extractChatHttpErrorMessage(e) ||
              "Preview rebuild after revert failed.",
          );
        }
        await refreshChatMessages(effectiveChatReleaseId);
      } catch (e) {
        const msgText =
          e?.response?.data?.error ||
          e?.error ||
          e?.message ||
          "Could not revert.";
        toast.error(msgText);
      } finally {
        setRevertLoadingKey(null);
      }
    },
    [
      effectiveChatReleaseId,
      identityEmail,
      projectSlug,
      refreshChatMessages,
      runTagBuildAndRefreshUi,
    ],
  );

  const handleOpenRevertConfirm = useCallback((msg) => {
    setRevertPendingMsg(msg);
    setRevertConfirmOpen(true);
  }, []);

  const revertFollowUpCount = useMemo(() => {
    if (revertPendingMsg == null || revertPendingMsg.id == null) return 0;
    const idx = chatMessages.findIndex((m) => m.id === revertPendingMsg.id);
    if (idx < 0) return 0;
    return Math.max(0, chatMessages.length - idx - 1);
  }, [chatMessages, revertPendingMsg]);

  const handleRevertConfirmProceed = useCallback(async () => {
    const msg = revertPendingMsg;
    setRevertConfirmOpen(false);
    setRevertPendingMsg(null);
    if (msg) await handleRevertMergedMessage(msg);
  }, [revertPendingMsg, handleRevertMergedMessage]);

  useEffect(() => {
    if (
      !isOpen ||
      effectiveChatReleaseId == null ||
      !projectSlug?.trim() ||
      !showMainChatUi
    )
      return;
    let cancelled = false;
    setChatHistoryLoading(true);
    (async () => {
      try {
        const rows = await refreshChatMessages(effectiveChatReleaseId);
        if (cancelled) return;
        setChatMessages(rows);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setChatHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    effectiveChatReleaseId,
    isOpen,
    projectSlug,
    refreshChatMessages,
    showMainChatUi,
  ]);

  useEffect(() => {
    if (
      !isOpen ||
      !showMainChatUi ||
      effectiveChatReleaseId == null ||
      !projectSlug?.trim()
    ) {
      setReleaseAgentBusy(false);
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await clientLinkFetchAgentStatus(
          projectSlug,
          Number(effectiveChatReleaseId),
        );
        if (cancelled) return;
        const busy = Boolean(st?.busy);
        setReleaseAgentBusy(busy);
      } catch {
        if (!cancelled) {
          setReleaseAgentBusy(false);
        }
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOpen, showMainChatUi, effectiveChatReleaseId, projectSlug]);

  useEffect(() => {
    if (!releaseAgentBusy) {
      busyAutoPollStartedRef.current = false;
      return;
    }
    if (
      !isOpen ||
      !showMainChatUi ||
      effectiveChatReleaseId == null ||
      chatPolling
    ) {
      return;
    }
    if (busyAutoPollStartedRef.current) return;
    busyAutoPollStartedRef.current = true;
    void pollUntilAgentSettles();
  }, [
    releaseAgentBusy,
    isOpen,
    showMainChatUi,
    effectiveChatReleaseId,
    chatPolling,
    pollUntilAgentSettles,
  ]);

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-l border-border bg-card text-card-foreground">
        <div className="shrink-0 border-b border-border bg-muted/50 px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-foreground">
              <img
                src={logo}
                alt="launchpad logo"
                className="w-7 h-7 shrink-0"
              />
              <span className="truncate">LaunchPad AI Chat</span>
            </h2>
            <div className="flex shrink-0 items-center gap-0.5">
              {showMainChatUi && canViewChat && !isLocked ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleRefreshLiveBuild()}
                      disabled={
                        refreshBuildBusy ||
                        !identityLooksValid ||
                        effectiveChatReleaseId == null
                      }
                      className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
                      aria-label="Refresh preview from git tag"
                    >
                      <RefreshCw
                        className={`size-4 ${refreshBuildBusy ? "animate-spin" : ""}`}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[14rem]">
                    Re-fetch the release tag, rebuild, and reload the live
                    preview
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onCloseChat}
                className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
                aria-label="Close chat panel"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!showMainChatUi && (
            <>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Enter your email to continue. Chat permissions are verified
                  securely on the server.
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="client-link-panel-chat-email">
                    Your email
                  </Label>
                  <Input
                    id="client-link-panel-chat-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={panelEmailInput}
                    onChange={(e) => {
                      setPanelEmailInput(e.target.value);
                      setGateInlineError("");
                    }}
                    className="rounded-lg border-input"
                  />
                  {gateInlineError ? (
                    <p className="text-xs text-destructive">
                      {gateInlineError}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    className="w-full bg-linear-to-r from-violet-600 to-indigo-600 font-semibold text-white shadow-md hover:from-violet-700 hover:to-indigo-700"
                    onClick={handleContinueEmail}
                    disabled={
                      !isPlausibleClientLinkEmail(
                        panelEmailInput.trim().toLowerCase(),
                      )
                    }
                  >
                    Continue
                  </Button>
                </div>
              </div>
            </>
          )}
          {showMainChatUi && !canViewChat && effectiveChatReleaseId == null && (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Choose a version in the header dropdown so we know which release
              to update.
            </p>
          )}
          {showMainChatUi && isLocked && (
            <p className="rounded-lg border border-red-500 bg-red-50 px-3 py-3 text-xs leading-relaxed text-red-500 m-4">
              This release is locked. Please switch to an active release to
              continue using the chat.
            </p>
          )}

          {showMainChatUi ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3">
                {chatMessages.length === 0 && !scratchTrim && (
                  <p className="text-sm text-muted-foreground">
                    Describe the change you want (e.g. &quot;Make the hero
                    button larger&quot;). Use{" "}
                    <span className="font-medium text-foreground">
                      Pick element
                    </span>{" "}
                    to select something in the preview — it appears as a tag in
                    the box below; hover the tag for full details.
                  </p>
                )}
                {displayMessages.map((msg, index) => (
                  <ChatMessageRow
                    key={msg.id ?? msg.key ?? `m-${index}`}
                    msg={msg}
                    index={index}
                    chatSending={chatSending}
                    chatPolling={chatPolling}
                    chatHistoryLoading={chatHistoryLoading}
                    revertLoadingKey={revertLoadingKey}
                    chatMayMutate={canMutateChat && !releaseAgentBusy}
                    onRequestRevertConfirm={handleOpenRevertConfirm}
                    onOpenImagePreview={openChatImagePreview}
                  />
                ))}
                {(chatSending || chatPolling) && (
                  <div
                    className="flex shrink-0 flex-col items-center gap-3 rounded-xl px-3 py-3 dark:border-violet-500/25 dark:from-violet-950/40 dark:via-card/90 dark:to-indigo-950/30"
                    role="status"
                    aria-live="polite"
                    aria-label="Cursor agent is working"
                  >
                    {/* Fixed height: Lottie intrinsic canvas is tall; unconstrained flex child pushed label below the fold */}
                    <div className="relative h-[148px] w-full max-w-[240px] shrink-0 overflow-hidden">
                      <Lottie
                        animationData={websiteChangesAnimation}
                        loop
                        className="h-full w-full [&_svg]:h-full [&_svg]:max-h-full [&_svg]:w-full"
                        rendererSettings={{
                          preserveAspectRatio: "xMidYMid meet",
                        }}
                      />
                    </div>
                    <p className="flex shrink-0 items-center justify-center gap-2 text-center text-xs font-semibold text-slate-800 dark:text-slate-100">
                      <Spinner className="size-3.5 shrink-0 text-primary" />
                      Applying changes…
                    </p>
                  </div>
                )}
                {chatHistoryLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="size-4" />
                    Loading conversation...
                  </div>
                )}
              </div>

              <div className="shrink-0 space-y-2 border-t border-border bg-card px-4 py-3">
                <div
                  className={cn(
                    "rounded-lg border border-slate-200/90 bg-white shadow-sm transition-shadow dark:border-border dark:bg-card",
                    composerDragOver &&
                      !composerDisabled &&
                      "ring-2 ring-primary/40 ring-offset-2 ring-offset-card",
                  )}
                  onDragOver={(e) => {
                    if (composerDisabled) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setComposerDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setComposerDragOver(false);
                    }
                  }}
                  onDrop={handleComposerDrop}
                >
                  <div
                    className="flex flex-col min-h-[48px] items-start gap-0 px-2 py-2"
                    role="group"
                    aria-label="Chat message composer. Drop images here to attach design references."
                  >
                    {pickedElementContext ||
                    (Array.isArray(stagedChatReferenceImages) &&
                      stagedChatReferenceImages.length > 0) ? (
                      <div className="flex w-full flex-wrap items-center gap-2 px-0.5 pt-0.5">
                        {pickedElementContext ? (
                          <>
                            <ElementContextChip
                              tag={pickedElementContext.tag}
                              inspectorCtx={pickedElementContext}
                              onRemove={() => onPickedElementContextChange(null)}
                              variant="composer"
                              className="shrink-0"
                            />
                            {pickedElementContext.replacementKind &&
                            previewIframeAccessible === true &&
                            previewIframeRef ? (
                              <PreviewReplaceImageButton
                                iframeRef={previewIframeRef}
                                context={pickedElementContext}
                                disabled={composerDisabled}
                                onResult={onPreviewReplaceImageResult}
                                onStagedForRepo={onReplacementStagedForRepo}
                                buttonClassName="h-8 shrink-0 rounded-full px-3"
                              />
                            ) : null}
                            {stagedChatReplacementImage &&
                            stagedChatReplacementImage.selector ===
                              pickedElementContext.selector &&
                            stagedChatReplacementImage.previewDataUrl ? (
                              <div className="group relative shrink-0">
                                <button
                                  type="button"
                                  className="overflow-hidden rounded-lg border border-slate-200/90 bg-linear-to-br from-slate-50 to-violet-50/80 p-0.5 shadow-sm ring-1 ring-violet-500/25 cursor-pointer transition hover:ring-violet-500/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:border-border dark:from-violet-950/40 dark:to-indigo-950/30 dark:ring-violet-400/20"
                                  title="Queued for this message — click to enlarge"
                                  aria-label="View queued replacement image"
                                  onClick={() =>
                                    openChatImagePreview(
                                      stagedChatReplacementImage.previewDataUrl,
                                    )
                                  }
                                >
                                  <img
                                    src={
                                      stagedChatReplacementImage.previewDataUrl
                                    }
                                    alt=""
                                    className={CHAT_ATTACHMENT_THUMB_CLASS}
                                    draggable={false}
                                  />
                                </button>
                                <button
                                  type="button"
                                  className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-slate-200/90 bg-white text-slate-600 shadow-md transition hover:bg-red-50 hover:text-red-600 dark:border-border dark:bg-card dark:hover:bg-red-950/50 dark:hover:text-red-300"
                                  aria-label="Remove queued image"
                                  disabled={composerDisabled}
                                  onClick={() =>
                                    onStagedChatReplacementImageChange(null)
                                  }
                                >
                                  <X className="size-3.5" aria-hidden />
                                </button>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {(Array.isArray(stagedChatReferenceImages)
                          ? stagedChatReferenceImages
                          : []
                        ).map((refImg, refIdx) =>
                          refImg?.previewDataUrl ? (
                            <div
                              key={`ref-${refIdx}`}
                              className="group relative shrink-0"
                            >
                              <button
                                type="button"
                                className="overflow-hidden rounded-lg border border-slate-200/90 bg-linear-to-br from-slate-50 to-sky-50/80 p-0.5 shadow-sm ring-1 ring-sky-500/25 cursor-pointer transition hover:ring-sky-500/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 dark:border-border dark:from-sky-950/40 dark:to-indigo-950/30 dark:ring-sky-400/20"
                                title="Design reference — click to enlarge"
                                aria-label={`View design reference image ${refIdx + 1}`}
                                onClick={() =>
                                  openChatImagePreview(refImg.previewDataUrl)
                                }
                              >
                                <img
                                  src={refImg.previewDataUrl}
                                  alt=""
                                  className={CHAT_ATTACHMENT_THUMB_CLASS}
                                  draggable={false}
                                />
                              </button>
                              <button
                                type="button"
                                className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-slate-200/90 bg-white text-slate-600 shadow-md transition hover:bg-red-50 hover:text-red-600 dark:border-border dark:bg-card dark:hover:bg-red-950/50 dark:hover:text-red-300"
                                aria-label={`Remove design reference image ${refIdx + 1}`}
                                disabled={composerDisabled}
                                onClick={() =>
                                  onStagedChatReferenceImagesChange((prev) =>
                                    (Array.isArray(prev) ? prev : []).filter(
                                      (_, i) => i !== refIdx,
                                    ),
                                  )
                                }
                              >
                                <X className="size-3.5" aria-hidden />
                              </button>
                            </div>
                          ) : null,
                        )}
                      </div>
                    ) : null}
                    <Textarea
                      placeholder="Type here to reflect changes..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      disabled={composerDisabled}
                      className="min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 dark:placeholder:text-muted-foreground"
                      onPaste={(e) => {
                        if (composerDisabled) return;
                        const cd = e.clipboardData;
                        if (!cd) return;
                        const fromFiles = Array.from(cd.files || []).filter((f) =>
                          f.type?.startsWith("image/"),
                        );
                        const pasteFiles = [...fromFiles];
                        if (!pasteFiles.length && cd.items?.length) {
                          for (const item of Array.from(cd.items)) {
                            if (
                              item.kind === "file" &&
                              item.type?.startsWith("image/")
                            ) {
                              const f = item.getAsFile();
                              if (f) pasteFiles.push(f);
                            }
                          }
                        }
                        if (!pasteFiles.length) return;
                        e.preventDefault();
                        void appendReferenceStagingFromFiles(pasteFiles);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (canMutateChat && !composerDisabled) {
                            void handleSendChat();
                          }
                        }
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-end justify-between gap-2 px-2 pb-2 pt-0">
                    <div
                      className={`flex min-w-0 flex-wrap items-end gap-2 ${composerEmailEditorOpen ? "flex-1" : ""}`}
                    >
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-full"
                        aria-expanded={composerEmailEditorOpen}
                        aria-label={
                          composerEmailEditorOpen
                            ? "Close email editor"
                            : "Edit chat email"
                        }
                        onClick={toggleComposerEmailEditor}
                      >
                        <User className="size-4" />
                      </Button>
                      {composerEmailEditorOpen ? (
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <Input
                              id="client-link-composer-chat-email"
                              type="email"
                              name="email"
                              autoComplete="email"
                              placeholder="Your stakeholder email"
                              value={composerEmailDraft}
                              onChange={(e) => {
                                setComposerEmailDraft(e.target.value);
                                setComposerEmailError("");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleSaveComposerEmail();
                                }
                              }}
                              disabled={composerDisabled}
                              className="h-9 min-w-0 flex-1 rounded-full border-slate-200/90 bg-white text-xs shadow-sm dark:border-border dark:bg-background"
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="secondary"
                              className="h-9 w-9 shrink-0 rounded-full"
                              aria-label="Update chat email"
                              disabled={
                                composerDisabled ||
                                !isPlausibleClientLinkEmail(
                                  composerEmailDraft.trim().toLowerCase(),
                                )
                              }
                              onClick={handleSaveComposerEmail}
                            >
                              <Check className="size-4" />
                            </Button>
                          </div>
                          {composerEmailError ? (
                            <p className="px-1 text-[10px] leading-tight text-destructive">
                              {composerEmailError}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex justify-center items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Button
                              type="button"
                              size="icon"
                              variant={visualPickMode ? "default" : "secondary"}
                              disabled={
                                !canMutateChat ||
                                composerDisabled ||
                                !visualPickSupported
                              }
                              className={`h-9 w-9 shrink-0 rounded-full disabled:opacity-40 ${
                                visualPickMode
                                  ? "bg-linear-to-br from-violet-600 to-indigo-600 text-white shadow-md hover:from-violet-700 hover:to-indigo-700"
                                  : ""
                              }`}
                              aria-pressed={visualPickMode}
                              aria-label={
                                visualPickMode
                                  ? "Exit pick element mode"
                                  : "Pick element in preview"
                              }
                              onClick={handleToggleVisualPick}
                            >
                              <SquareMousePointer className="size-4" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="max-w-[260px] text-xs leading-relaxed"
                        >
                          {visualPickSupported
                            ? "Turn this on and select the part of the UI you'd like to edit"
                            : visualPickDisabledReason}
                        </TooltipContent>
                      </Tooltip>
                      <input
                        ref={chatImageFileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        tabIndex={-1}
                        aria-hidden
                        onChange={handleChatImageFileChange}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Button
                              type="button"
                              size="icon"
                              variant="secondary"
                              disabled={!canMutateChat || composerDisabled}
                              className="h-9 w-9 shrink-0 rounded-full disabled:opacity-40"
                              aria-label="Attach design reference images"
                              onClick={() =>
                                chatImageFileInputRef.current?.click()
                              }
                            >
                              <ImagePlus className="size-4" aria-hidden />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[260px] text-xs">
                          Attach one or more screenshots or mockups (same as
                          drag-and-drop). Up to {MAX_STAGED_REFERENCE_IMAGES} per
                          message.
                        </TooltipContent>
                      </Tooltip>
                      <Button
                        type="button"
                        size="icon"
                        disabled={!canMutateChat || composerDisabled}
                        className="h-9 w-9 shrink-0 rounded-full disabled:opacity-40"
                        aria-label="Send message"
                        onClick={() => void handleSendChat()}
                      >
                        {chatSending || chatPolling ? (
                          <Spinner className="size-4 text-white" />
                        ) : (
                          <ArrowUp className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog
        open={revertConfirmOpen}
        onOpenChange={(open) => {
          setRevertConfirmOpen(open);
          if (!open) setRevertPendingMsg(null);
        }}
      >
        <DialogContent showCloseButton className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Discard all changes up to this checkpoint?
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1 text-left">
              <span className="block">
                This will remove all changes made up to this checkpoint. This
                action cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                setRevertConfirmOpen(false);
                setRevertPendingMsg(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={revertLoadingKey != null}
              className="rounded-lg font-semibold text-white shadow-md disabled:opacity-50"
              onClick={() => void handleRevertConfirmProceed()}
            >
              Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={chatImagePreviewUrl != null}
        onOpenChange={(open) => {
          if (!open) setChatImagePreviewUrl(null);
        }}
      >
        <DialogContent
          showCloseButton
          className="max-h-[90vh] w-[min(96vw,1200px)] max-w-[min(96vw,1200px)] overflow-y-auto overflow-x-hidden border-neutral-800 bg-neutral-950 p-2 sm:p-4"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Image preview</DialogTitle>
          </DialogHeader>
          {chatImagePreviewUrl ? (
            <img
              src={chatImagePreviewUrl}
              alt=""
              className="mx-auto max-h-[min(85vh,900px)] w-auto max-w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
});

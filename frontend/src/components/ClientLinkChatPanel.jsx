import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clientLinkConfirmMerge,
  clientLinkFetchAgentStatus,
  clientLinkFetchChatMessages,
  clientLinkFetchExecutionSummary,
  clientLinkPreviewCommit,
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
  setClientLinkVerifiedEmail,
} from "@/lib/clientLinkVerifiedEmail";
import {
  ArrowUp,
  Check,
  Crosshair,
  RotateCcw,
  SquareMousePointer,
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
} from "@/components/ClientLinkPreviewPicker";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import Lottie from "lottie-react";
import logo from "../assets/fevicon.png";
import websiteChangesAnimation from "../assets/website-changes-animations.json";

const USER_BUBBLE_CLASS =
  "ml-6 rounded-lg rounded-br-xs bg-primary px-3 py-2 text-sm text-primary-foreground shadow-xs";
const SYSTEM_NEUTRAL_BUBBLE_CLASS =
  "mr-6 rounded-lg rounded-tl-xs border border-border bg-muted/60 px-3 py-2 text-sm text-foreground shadow-xs";
const SYSTEM_SUCCESS_BUBBLE_CLASS =
  "mr-6 rounded-lg rounded-tl-xs border border-emerald-500/35 bg-emerald-500/5 px-3 py-2 text-sm text-foreground shadow-xs";
const SYSTEM_ERROR_BUBBLE_CLASS =
  "mr-6 rounded-lg rounded-tl-xs border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground shadow-xs";

const LOCK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const iconClass =
    variant === "onPrimary" ? "text-white" : "text-primary";

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

const ChatMessageRow = React.memo(function ChatMessageRow({
  msg,
  index,
  chatSending,
  chatPolling,
  chatHistoryLoading,
  revertingMessageKey,
  appliedMessageKey,
  chatMayMutate,
  onApplyMessageChanges,
}) {
  const rowKey = msg.id ?? msg.key ?? null;
  const isMerged = Boolean(msg?.isMerged);
  const isApplied = appliedMessageKey === rowKey;
  const isApplying = revertingMessageKey === rowKey;
  const disableApply =
    !chatMayMutate ||
    isMerged ||
    chatSending ||
    chatPolling ||
    chatHistoryLoading ||
    revertingMessageKey != null ||
    isApplied ||
    isApplying;

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
          <p className="w-full whitespace-pre-wrap break-words text-sm leading-relaxed">
            {elementSplit.userText}
          </p>
        </div>
      ) : (
        msg.text
      )}
      {msg.role === "user" && msg.appliedCommitSha ? (
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disableApply}
            className="h-7 rounded-lg border border-white/40 bg-white/15 px-2 text-[11px] font-semibold text-white hover:bg-white/25 disabled:text-white"
            onClick={() => void onApplyMessageChanges(msg)}
          >
            {isApplying ? (
              <span className="flex items-center gap-1">
                <Spinner className="size-3" />
                Applying...
              </span>
            ) : isMerged ? (
              <span className="flex items-center gap-1">
                Merged{mergedAtText ? ` - ${mergedAtText}` : ""}
              </span>
            ) : isApplied ? (
              <span className="flex items-center gap-1">Applied</span>
            ) : (
              <span className="flex items-center gap-1">
                <RotateCcw className="size-3" />
                Apply changes
              </span>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
});

export const ClientLinkChatPanel = React.memo(function ClientLinkChatPanel({
  projectSlug,
  effectiveChatReleaseId,
  isLocked,
  isOpen,
  mergeTargetLabel,
  onPreviewCommitApplied,
  onProjectReload,
  onResetPreview,
  onCloseChat,
  pickedElementContext = null,
  onPickedElementContextChange = () => {},
  visualPickMode = false,
  onVisualPickModeChange = () => {},
  previewIframeAccessible = null,
}) {
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatSending, setChatSending] = useState(false);
  const [chatPolling, setChatPolling] = useState(false);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [mergeAwaitingConfirm, setMergeAwaitingConfirm] = useState(false);
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const [confirmMergeOpen, setConfirmMergeOpen] = useState(false);
  const [revertingMessageKey, setRevertingMessageKey] = useState(null);
  const [appliedMessageKey, setAppliedMessageKey] = useState(null);
  const [verifyBump, setVerifyBump] = useState(0);
  const [panelEmailInput, setPanelEmailInput] = useState("");
  const [gateInlineError, setGateInlineError] = useState("");
  const [composerEmailEditorOpen, setComposerEmailEditorOpen] = useState(false);
  const [composerEmailDraft, setComposerEmailDraft] = useState("");
  const [composerEmailError, setComposerEmailError] = useState("");

  const autoApplyArmedRef = useRef({ releaseId: null, armed: false });
  const lastAutoAppliedRef = useRef({
    releaseId: null,
    messageId: null,
    sha: null,
  });
  const lastAgentSnapshotRef = useRef({
    releaseId: null,
    status: null,
    activity: null,
  });

  const identityEmail = useMemo(
    () => getClientLinkVerifiedEmail(),
    [verifyBump, isOpen],
  );
  const identityLooksValid =
    Boolean(identityEmail) && LOCK_EMAIL_RE.test(identityEmail);
  const showMainChatUi = identityLooksValid;

  const canViewChat =
    Boolean(projectSlug?.trim()) && effectiveChatReleaseId != null;
  const canMutateChat = canViewChat && !isLocked && identityLooksValid;

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
    setPanelEmailInput(s && LOCK_EMAIL_RE.test(s) ? s : "");
    setGateInlineError("");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setComposerEmailEditorOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !showMainChatUi || composerEmailEditorOpen) return;
    const s = getClientLinkVerifiedEmail();
    setComposerEmailDraft(s && LOCK_EMAIL_RE.test(s) ? s : "");
    setComposerEmailError("");
  }, [isOpen, showMainChatUi, verifyBump, composerEmailEditorOpen]);

  const toggleComposerEmailEditor = useCallback(() => {
    setComposerEmailEditorOpen((open) => {
      const next = !open;
      if (next) {
        const s = getClientLinkVerifiedEmail();
        setComposerEmailDraft(s && LOCK_EMAIL_RE.test(s) ? s : "");
        setComposerEmailError("");
      }
      return next;
    });
  }, []);

  const handleContinueEmail = useCallback(() => {
    const email = panelEmailInput.trim().toLowerCase();
    if (!LOCK_EMAIL_RE.test(email)) {
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
        tone: row.tone || undefined,
        text: row.text,
        key: row.msgKey || `db:${row.id}`,
        appliedCommitSha: row.appliedCommitSha || null,
        isMerged: Boolean(row.isMerged),
        mergedAt: row.mergedAt || null,
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
    if (!LOCK_EMAIL_RE.test(email)) {
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

  const selectedAppliedMessage = useMemo(
    () =>
      chatMessages.find(
        (m) =>
          m?.role === "user" &&
          (m.id ?? m.key ?? null) === appliedMessageKey &&
          typeof m?.appliedCommitSha === "string" &&
          m.appliedCommitSha.trim(),
      ) || null,
    [appliedMessageKey, chatMessages],
  );

  const confirmMergeMessageSplit = useMemo(() => {
    const t = selectedAppliedMessage?.text;
    if (typeof t !== "string" || !t.trim()) return null;
    return splitFollowupWithElementContext(t);
  }, [selectedAppliedMessage?.text]);

  const applyMessageToPreview = useCallback(
    async (msg) => {
      if (!projectSlug?.trim() || effectiveChatReleaseId == null) return false;
      const sha =
        typeof msg?.appliedCommitSha === "string"
          ? msg.appliedCommitSha.trim()
          : "";
      if (!sha) {
        toast.error("No commit is recorded for this message yet.");
        return false;
      }

      const key = msg.id ?? msg.key ?? sha;
      setRevertingMessageKey(key);
      try {
        const preview = await clientLinkPreviewCommit(
          projectSlug,
          effectiveChatReleaseId,
          sha,
          false,
          msg?.id,
          identityEmail,
        );
        const baseUrl = String(preview?.buildUrl || "").trim();
        if (!baseUrl)
          throw new Error("Preview URL missing from server response.");
        onPreviewCommitApplied?.({
          buildUrl: baseUrl,
          releaseId: Number(effectiveChatReleaseId),
        });
        setAppliedMessageKey(key);
        toast.success(
          `Applied commit ${String(preview?.commitSha || "").slice(0, 7)} to preview.`,
        );
        return true;
      } catch (e) {
        const msgText =
          e?.response?.data?.error ||
          e?.error ||
          e?.message ||
          "Could not preview this commit.";
        toast.error(msgText);
        return false;
      } finally {
        setRevertingMessageKey(null);
      }
    },
    [
      effectiveChatReleaseId,
      identityEmail,
      onPreviewCommitApplied,
      projectSlug,
    ],
  );

  const autoApplyLatestChatCommit = useCallback(
    async (rows, rid) => {
      if (
        !projectSlug?.trim() ||
        rid == null ||
        !Array.isArray(rows) ||
        rows.length === 0
      ) {
        return false;
      }
      const latestAppliedUser = [...rows]
        .reverse()
        .find(
          (m) =>
            m?.role === "user" &&
            typeof m?.appliedCommitSha === "string" &&
            m.appliedCommitSha.trim(),
        );
      if (!latestAppliedUser) return false;

      const sha = latestAppliedUser.appliedCommitSha.trim();
      const mid = Number(latestAppliedUser.id);
      if (
        lastAutoAppliedRef.current.releaseId === Number(rid) &&
        lastAutoAppliedRef.current.messageId ===
          (Number.isInteger(mid) ? mid : null) &&
        lastAutoAppliedRef.current.sha === sha
      ) {
        setAppliedMessageKey(
          latestAppliedUser.id ?? latestAppliedUser.key ?? sha,
        );
        return true;
      }

      const applied = await applyMessageToPreview(latestAppliedUser);
      if (applied) {
        lastAutoAppliedRef.current = {
          releaseId: Number(rid),
          messageId: Number.isInteger(mid) ? mid : null,
          sha,
        };
      }
      return applied;
    },
    [applyMessageToPreview, projectSlug],
  );

  const pollUntilAgentSettles = useCallback(async () => {
    if (!projectSlug?.trim() || effectiveChatReleaseId == null) return;
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

        if (raw && !isCursorAgentSuccessTerminal(raw))
          setMergeAwaitingConfirm(false);

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
            const needsMergeConfirm =
              Boolean(st?.mergeConfirmationPending) ||
              Boolean(st?.awaitingLaunchpadConfirmation) ||
              Boolean(st?.deferLaunchpadMerge);
            if (needsMergeConfirm) {
              setMergeAwaitingConfirm(true);
              const rows = await refreshChatMessages(effectiveChatReleaseId);
              const canAutoApply =
                autoApplyArmedRef.current.armed &&
                autoApplyArmedRef.current.releaseId ===
                  Number(effectiveChatReleaseId);
              if (canAutoApply) {
                const applied = await autoApplyLatestChatCommit(
                  rows,
                  effectiveChatReleaseId,
                );
                if (applied) {
                  autoApplyArmedRef.current = {
                    releaseId: Number(effectiveChatReleaseId),
                    armed: false,
                  };
                }
              }
              addSystemMessageOnce(
                `merge-confirm:${effectiveChatReleaseId}`,
                "The agent finished. Review the work, then confirm below to merge into launchpad and refresh the live site.",
                "neutral",
              );
              return;
            }

            setMergeAwaitingConfirm(false);
            setChatMessages((m) => [
              ...m,
              {
                role: "system",
                tone: "success",
                key: `applied:${effectiveChatReleaseId}:${Date.now()}`,
                text: "Changes applied. Refreshing preview...",
              },
            ]);
            await onProjectReload?.();
            onResetPreview?.();

            try {
              const sum = await clientLinkFetchExecutionSummary(
                projectSlug,
                effectiveChatReleaseId,
              );
              if (sum?.pendingMergeConfirmation) {
                setMergeAwaitingConfirm(true);
                addSystemMessageOnce(
                  `merge-confirm-pending:${effectiveChatReleaseId}`,
                  "Confirm merge to launchpad to create a new version and update the live preview.",
                  "neutral",
                );
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
      setChatPolling(false);
    }
  }, [
    addSystemMessageOnce,
    autoApplyLatestChatCommit,
    effectiveChatReleaseId,
    onProjectReload,
    onResetPreview,
    projectSlug,
    refreshChatMessages,
  ]);

  const handleSendChat = useCallback(async () => {
    const userPart = chatInput.trim();
    if (!userPart || !projectSlug?.trim()) {
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

    const rid = Number(effectiveChatReleaseId);
    setChatSending(true);
    try {
      setChatMessages((m) => [...m, { role: "user", text }]);
      setChatInput("");
      onPickedElementContextChange(null);
      await clientLinkSendFollowup(projectSlug, rid, text, identityEmail);
      autoApplyArmedRef.current = { releaseId: rid, armed: true };
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
    } finally {
      setChatSending(false);
    }
  }, [
    chatInput,
    effectiveChatReleaseId,
    identityEmail,
    isLocked,
    onPickedElementContextChange,
    pickedElementContext,
    pollUntilAgentSettles,
    projectSlug,
  ]);

  const handleConfirmMerge = useCallback(async () => {
    if (!projectSlug?.trim() || effectiveChatReleaseId == null) return;
    const selected = selectedAppliedMessage;
    const selectedSha =
      typeof selected?.appliedCommitSha === "string"
        ? selected.appliedCommitSha.trim()
        : "";
    if (!selectedSha) {
      toast.error("Apply a chat change first, then confirm merge.");
      return;
    }
    setConfirmingMerge(true);
    try {
      await clientLinkConfirmMerge(
        projectSlug,
        effectiveChatReleaseId,
        selectedSha,
        selected?.id ?? null,
        identityEmail,
      );
      setMergeAwaitingConfirm(false);
      setConfirmMergeOpen(false);
      toast.success("Changes merged to launchpad");
      await onProjectReload?.();
      onResetPreview?.();
      await refreshChatMessages(effectiveChatReleaseId);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.error ||
        e?.message ||
        "Could not merge to launchpad.";
      toast.error(msg);
    } finally {
      setConfirmingMerge(false);
    }
  }, [
    effectiveChatReleaseId,
    onProjectReload,
    onResetPreview,
    projectSlug,
    refreshChatMessages,
    selectedAppliedMessage,
    identityEmail,
  ]);

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
      effectiveChatReleaseId == null ||
      !projectSlug?.trim() ||
      !showMainChatUi
    )
      return;
    let cancelled = false;
    (async () => {
      try {
        const st = await clientLinkFetchAgentStatus(
          projectSlug,
          effectiveChatReleaseId,
        );
        if (cancelled) return;
        const raw = st?.status
          ? String(st.status).trim().toUpperCase().replace(/\s+/g, "_")
          : "";
        if (
          isCursorAgentSuccessTerminal(raw) &&
          (st?.mergeConfirmationPending ||
            st?.awaitingLaunchpadConfirmation ||
            st?.deferLaunchpadMerge)
        ) {
          setMergeAwaitingConfirm(true);
          const rows = await refreshChatMessages(effectiveChatReleaseId);
          const canAutoApply =
            autoApplyArmedRef.current.armed &&
            autoApplyArmedRef.current.releaseId ===
              Number(effectiveChatReleaseId);
          if (canAutoApply) {
            const applied = await autoApplyLatestChatCommit(
              rows,
              effectiveChatReleaseId,
            );
            if (applied) {
              autoApplyArmedRef.current = {
                releaseId: Number(effectiveChatReleaseId),
                armed: false,
              };
            }
          }
          addSystemMessageOnce(
            `merge-confirm:${effectiveChatReleaseId}`,
            "The agent finished. Review the work, then confirm below to merge into launchpad and refresh the live site.",
            "neutral",
          );
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    addSystemMessageOnce,
    autoApplyLatestChatCommit,
    effectiveChatReleaseId,
    isOpen,
    showMainChatUi,
    projectSlug,
    refreshChatMessages,
  ]);

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-l border-border bg-card text-card-foreground">
        <div className="shrink-0 border-b border-border bg-muted/50 px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <img src={logo} alt="launchpad logo" className="w-7 h-7" />
              LaunchPad AI Chat
            </h2>
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
                      !LOCK_EMAIL_RE.test(panelEmailInput.trim().toLowerCase())
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
                {chatMessages.length === 0 && (
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
                {chatMessages.map((msg, index) => (
                  <ChatMessageRow
                    key={msg.id ?? msg.key ?? `m-${index}`}
                    msg={msg}
                    index={index}
                    chatSending={chatSending}
                    chatPolling={chatPolling}
                    chatHistoryLoading={chatHistoryLoading}
                    revertingMessageKey={revertingMessageKey}
                    appliedMessageKey={appliedMessageKey}
                    chatMayMutate={canMutateChat}
                    onApplyMessageChanges={applyMessageToPreview}
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
                {mergeAwaitingConfirm && !isLocked && (
                  <>
                    {!selectedAppliedMessage ? (
                      <p className="text-xs text-muted-foreground">
                        Apply one chat change in preview first, then confirm
                        merge.
                      </p>
                    ) : (
                      <Button
                        type="button"
                        disabled={
                          !canMutateChat ||
                          chatSending ||
                          chatPolling ||
                          confirmingMerge ||
                          chatHistoryLoading
                        }
                        size="sm"
                        className="w-full bg-linear-to-r from-violet-600 to-indigo-600 font-semibold text-white shadow-md hover:from-violet-700 hover:to-indigo-700"
                        onClick={() => setConfirmMergeOpen(true)}
                      >
                        {confirmingMerge ? (
                          <span className="flex items-center justify-center gap-2">
                            <Spinner className="size-4" />
                            Merging...
                          </span>
                        ) : (
                          "Confirm changes"
                        )}
                      </Button>
                    )}
                  </>
                )}
                <div className="rounded-lg border border-slate-200/90 bg-white shadow-sm dark:border-border dark:bg-card">
                  <div className="flex flex-col min-h-[48px] items-start gap-0 px-2 py-2">
                    {pickedElementContext ? (
                      <ElementContextChip
                        tag={pickedElementContext.tag}
                        inspectorCtx={pickedElementContext}
                        onRemove={() => onPickedElementContextChange(null)}
                        variant="composer"
                        className="self-start"
                      />
                    ) : null}
                    <Textarea
                      placeholder="Type here to reflect changes..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      disabled={
                        !canMutateChat ||
                        chatSending ||
                        chatPolling ||
                        chatHistoryLoading
                      }
                      className="min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 dark:placeholder:text-muted-foreground"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (
                            canMutateChat &&
                            !chatSending &&
                            !chatPolling &&
                            !chatHistoryLoading
                          ) {
                            void handleSendChat();
                          }
                        }
                      }}
                    />
                  </div>
                  <div className="flex items-end justify-between gap-2 px-2 pb-2 pt-0">
                    <div
                      className={`flex min-w-0 items-end gap-2 ${composerEmailEditorOpen ? "flex-1" : ""}`}
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
                              disabled={
                                chatSending || chatPolling || chatHistoryLoading
                              }
                              className="h-9 min-w-0 flex-1 rounded-full border-slate-200/90 bg-white text-xs shadow-sm dark:border-border dark:bg-background"
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="secondary"
                              className="h-9 w-9 shrink-0 rounded-full"
                              aria-label="Update chat email"
                              disabled={
                                chatSending ||
                                chatPolling ||
                                chatHistoryLoading ||
                                !LOCK_EMAIL_RE.test(
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
                                chatSending ||
                                chatPolling ||
                                chatHistoryLoading ||
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
                      <Button
                        type="button"
                        size="icon"
                        disabled={
                          !canMutateChat ||
                          chatSending ||
                          chatPolling ||
                          chatHistoryLoading
                        }
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
      <Dialog open={confirmMergeOpen} onOpenChange={setConfirmMergeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm changes?</DialogTitle>
            <DialogDescription>
              These changes will be merged into Release{" "}
              <span className="font-medium text-foreground">
                {mergeTargetLabel || "the selected release/version"}
              </span>{" "}
              and update the live website.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Chat message</p>
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
              {!selectedAppliedMessage?.text ? (
                <span className="text-muted-foreground">
                  No applied chat message selected.
                </span>
              ) : confirmMergeMessageSplit ? (
                <div className="flex flex-col gap-2.5">
                  <div className="flex justify-start">
                    <ElementContextChip
                      tag={confirmMergeMessageSplit.tag}
                      contextBlock={confirmMergeMessageSplit.contextBlock}
                      variant="composer"
                      className="self-start"
                    />
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {confirmMergeMessageSplit.userText}
                  </p>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words leading-relaxed">
                  {selectedAppliedMessage.text}
                </p>
              )}
            </div>
          </div>
          <DialogFooter showCloseButton={false}>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmMergeOpen(false)}
              disabled={confirmingMerge}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-linear-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
              onClick={() => void handleConfirmMerge()}
              disabled={confirmingMerge || !selectedAppliedMessage}
            >
              {confirmingMerge ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-4" />
                  Merging...
                </span>
              ) : (
                "Confirm changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

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
import { ArrowUp, Check, Plus, RotateCcw, User, X } from "lucide-react";
import { toast } from "sonner";
import logo from "../assets/fevicon.png";

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

function extractChatHttpErrorMessage(err) {
  return (
    err?.response?.data?.error ||
    err?.error ||
    err?.message ||
    ""
  );
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

  return (
    <div
      key={msg.id ?? msg.key ?? `m-${index}`}
      className={msg.role === "user" ? USER_BUBBLE_CLASS : systemClass}
    >
      {msg.text}
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
  const [composerEmailEditorOpen, setComposerEmailEditorOpen] =
    useState(false);
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
    const text = chatInput.trim();
    if (!text || !projectSlug?.trim()) {
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

    const rid = Number(effectiveChatReleaseId);
    setChatSending(true);
    try {
      setChatMessages((m) => [...m, { role: "user", text }]);
      setChatInput("");
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
      <div className="flex h-full min-h-0 flex-col border-l border-border bg-card text-card-foreground">
        <div className="border-b border-border bg-muted/50 px-4 py-2">
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

        <div className="flex min-h-0 flex-1 flex-col">
            {!showMainChatUi && (
              <>
                <div className="space-y-3 px-4 py-3">
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
                        !LOCK_EMAIL_RE.test(
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
            {showMainChatUi &&
              !canViewChat &&
              effectiveChatReleaseId == null && (
                <p className="text-xs text-muted-foreground px-4py-3">
                  Choose a version in the header dropdown so we know which
                  release to update.
                </p>
              )}
            {showMainChatUi && isLocked && (
              <p className="rounded-lg border border-red-500 bg-red-50 px-3 py-3 text-xs leading-relaxed text-red-500 m-4">
                This release is locked. Please switch to an active release to continue using the chat.
              </p>
            )}

          {showMainChatUi ? (
            <>
              <div className="min-h-[200px] flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {chatMessages.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Describe the change you want (e.g. &quot;Make the hero
                    button larger&quot;).
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
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="size-4" />
                    Applying changes...
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
                    className="resize-none border-0 bg-transparent px-3 pb-1 pt-3 text-sm shadow-none placeholder:tex focus-visible:ring-0 focus-visible:ring-offset-0 dark:placeholder:text-muted-foreground"
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
                                chatSending ||
                                chatPolling ||
                                chatHistoryLoading
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
            </>
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
              {selectedAppliedMessage?.text ||
                "No applied chat message selected."}
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

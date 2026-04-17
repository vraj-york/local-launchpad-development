import React, { useCallback, useRef, useState } from "react";
import { ImageUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  runAiPreviewSvgFromSelection,
  runPreviewImageReplaceFromFile,
} from "@/lib/previewImageReplace";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

/**
 * @param {{
 *   iframeRef: React.RefObject<HTMLIFrameElement | null>,
 *   context: { selector?: string, replacementKind?: string | null } | null,
 *   onResult?: (r: { ok: boolean, message?: string }) => void,
 *   onStagedForRepo?: (p: { previewDataUrl: string, mimeType: string, width: number, height: number, selector: string }) => void,
 *   disabled?: boolean,
 *   className?: string,
 *   buttonClassName?: string,
 *   clientLinkAiSvgContext?: {
 *     slug: string,
 *     releaseId: number | string | null,
 *     getClientEmail?: () => string | null | undefined,
 *     clientEmail?: string,
 *   } | null,
 * }} props
 */
export function PreviewReplaceImageButton({
  iframeRef,
  context,
  disabled = false,
  onResult,
  onStagedForRepo,
  clientLinkAiSvgContext = null,
  className,
  buttonClassName,
}) {
  const replaceInputRef = useRef(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [animateAi, setAnimateAi] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [generatingAi, setGeneratingAi] = useState(false);

  const openReplacePicker = useCallback(() => {
    if (disabled || !context?.replacementKind) return;
    replaceInputRef.current?.click();
  }, [disabled, context?.replacementKind]);

  const onReplaceChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !context?.replacementKind) return;
      const result = await runPreviewImageReplaceFromFile(
        iframeRef?.current ?? null,
        context,
        file,
        {
          onStagedForRepo: onStagedForRepo
            ? (payload) => onStagedForRepo(payload)
            : undefined,
        },
      );
      onResult?.(result);
    },
    [iframeRef, context, onResult, onStagedForRepo],
  );

  const runAiSvg = useCallback(async () => {
    if (disabled || generatingAi || !context?.replacementKind) return;
    setGeneratingAi(true);
    try {
      const result = await runAiPreviewSvgFromSelection(
        iframeRef?.current ?? null,
        context,
        {
          animate: animateAi,
          customPrompt: customPrompt.trim() || undefined,
          clientLinkAiSvgContext: clientLinkAiSvgContext ?? undefined,
          onStagedForRepo: onStagedForRepo
            ? (payload) => onStagedForRepo(payload)
            : undefined,
        },
      );
      onResult?.(result);
      if (result.ok) setAiOpen(false);
    } finally {
      setGeneratingAi(false);
    }
  }, [
    iframeRef,
    context,
    animateAi,
    disabled,
    generatingAi,
    onResult,
    onStagedForRepo,
    clientLinkAiSvgContext,
    customPrompt,
  ]);

  if (!context?.replacementKind) return null;

  const baseBtn =
    "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-semibold transition disabled:pointer-events-none disabled:opacity-40 cursor-pointer";

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onReplaceChange(e)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={openReplacePicker}
        className={cn(
          baseBtn,
          "bg-primary text-white",
          buttonClassName,
        )}
      >
        <ImageUp className="size-3.5 shrink-0" aria-hidden />
        Replace image
      </button>

      <Popover open={aiOpen} onOpenChange={setAiOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || generatingAi}
            className={cn(
              baseBtn,
              "border border-violet-500/80 bg-violet-600 text-white hover:bg-violet-600/90",
              buttonClassName,
            )}
          >
            <Sparkles className="size-3.5 shrink-0" aria-hidden />
            {generatingAi ? "Generating…" : "AI SVG"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 min-w-[18rem] space-y-3" align="start">
          <div className="text-sm font-medium text-foreground">AI SVG</div>
          <p className="text-xs text-muted-foreground">
            Uses the <strong className="font-medium text-foreground">selected</strong>{" "}
            preview region as the reference: <code className="rounded bg-muted px-1">&lt;img&gt;</code>,{" "}
            <code className="rounded bg-muted px-1">&lt;svg&gt;</code>, CSS backgrounds (
            <code className="rounded bg-muted px-1">url()</code>, gradients), or a box (
            <code className="rounded bg-muted px-1">&lt;div&gt;</code>
            , etc.) via a snapshot. The API key stays on the server (
            <code className="rounded bg-muted px-1">CLAUDE_API_KEY</code>).
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={animateAi}
              onCheckedChange={(v) => setAnimateAi(v === true)}
              disabled={disabled || generatingAi}
            />
            <span>Animate (second model pass)</span>
          </label>
          <div className="space-y-1.5">
            <label
              htmlFor="ai-svg-custom-prompt"
              className="text-xs font-medium text-foreground"
            >
              Custom instructions (optional)
            </label>
            <Textarea
              id="ai-svg-custom-prompt"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="e.g. emphasize the logo, softer corners, no text…"
              disabled={disabled || generatingAi}
              rows={3}
              className="min-h-[4.5rem] resize-y text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Appended to the base prompt; with Animate, also applied to the animation pass.
            </p>
          </div>
          <button
            type="button"
            disabled={disabled || generatingAi}
            onClick={() => void runAiSvg()}
            className="w-full rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            Generate from selection
          </button>
        </PopoverContent>
      </Popover>
    </span>
  );
}

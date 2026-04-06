import React, { useCallback, useRef } from "react";
import { ImageUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { runPreviewImageReplaceFromFile } from "@/lib/previewImageReplace";

/**
 * @param {{
 *   iframeRef: React.RefObject<HTMLIFrameElement | null>,
 *   context: { selector?: string, replacementKind?: string | null } | null,
 *   onResult?: (r: { ok: boolean, message?: string }) => void,
 *   onStagedForRepo?: (p: { previewDataUrl: string, mimeType: string, width: number, height: number, selector: string }) => void,
 *   disabled?: boolean,
 *   className?: string,
 *   buttonClassName?: string,
 * }} props
 */
export function PreviewReplaceImageButton({
  iframeRef,
  context,
  disabled = false,
  onResult,
  onStagedForRepo,
  className,
  buttonClassName,
}) {
  const inputRef = useRef(null);

  const openPicker = useCallback(() => {
    if (disabled || !context?.replacementKind) return;
    inputRef.current?.click();
  }, [disabled, context?.replacementKind]);

  const onChange = useCallback(
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

  if (!context?.replacementKind) return null;

  return (
    <span className={cn("inline-flex", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onChange(e)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-[11px] font-semibold text-white transition disabled:pointer-events-none disabled:opacity-40 cursor-pointer",
          buttonClassName,
        )}
      >
        <ImageUp className="size-3.5 shrink-0" aria-hidden />
        Replace image
      </button>
    </span>
  );
}

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { AgentMode, ModelInfo } from "@/lib/types";
import { useHaptics } from "@/hooks/use-haptics";
import { apiFetch } from "@/lib/api-fetch";
import { ChevronDown, Spinner, StopIcon, PlusIcon, ArrowUp, CloseIcon } from "./icons";

const MODES: { id: AgentMode; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "ask", label: "Ask" },
  { id: "plan", label: "Plan" },
];

interface AttachedImage {
  file: File;
  preview: string;
}

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  selectedModel: string;
  selectedMode: AgentMode;
  onModelChange: (model: string) => void;
  onModeChange: (mode: AgentMode) => void;
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  selectedModel,
  selectedMode,
  onModelChange,
  onModeChange,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const haptics = useHaptics();

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.models?.length > 0) setModels(data.models);
      })
      .catch((err) => console.error("[models] Failed to fetch:", err))
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addImages = useCallback((files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith("image/"));
    if (valid.length === 0) return;
    const newImages = valid.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const uploadImages = useCallback(async (imgs: AttachedImage[]): Promise<string[]> => {
    const form = new FormData();
    for (const img of imgs) form.append("file", img.file);
    const res = await apiFetch("/api/upload", { method: "POST", body: form });
    if (!res.ok) return [];
    const data = await res.json();
    return data.paths || [];
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed && images.length === 0) return;
    haptics.send();

    let prompt = trimmed;
    if (images.length > 0) {
      setUploading(true);
      try {
        const paths = await uploadImages(images);
        if (paths.length > 0) {
          const refs = paths.map((p) => `[Attached image: ${p}]`).join("\n");
          prompt = prompt ? prompt + "\n\n" + refs : refs;
        }
      } catch {
        console.error("[upload] Failed to upload images");
      } finally {
        setUploading(false);
      }
      for (const img of images) URL.revokeObjectURL(img.preview);
      setImages([]);
    }

    if (prompt) onSend(prompt);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, images, onSend, haptics, uploadImages]);

  const handleStop = useCallback(() => {
    haptics.tap();
    onStop?.();
  }, [onStop, haptics]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageFiles = items
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (imageFiles.length > 0) {
      e.preventDefault();
      addImages(imageFiles);
    }
  }, [addImages]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) addImages(files);
  }, [addImages]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const currentModelLabel = models.find((m) => m.id === selectedModel)?.label || selectedModel;

  const autoModel = models.find((m) => m.id === "auto");
  const rest = models.filter((m) => m.id !== "auto");

  return (
    <div className="shrink-0 bg-bg px-4 py-3 safe-bottom">
      <div className="max-w-3xl mx-auto">
        <div
          className={`relative bg-bg-surface border rounded-xl focus-within:border-text-muted/40 transition-colors ${
            dragOver ? "border-accent/60 bg-accent/5" : "border-border"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isStreaming ? "Type to queue a message..." : "Ask Cursor anything..."}
            aria-label="Message input"
            rows={1}
            className="w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 pr-10 text-[13px] text-text placeholder:text-text-muted focus:outline-none"
          />

          {images.length > 0 && (
            <div className="flex gap-2 px-3 pb-1.5 overflow-x-auto">
              {images.map((img, i) => (
                <div key={img.preview} className="relative shrink-0 w-14 h-14 rounded-md overflow-hidden border border-border group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.preview} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-0 right-0 p-0.5 bg-black/70 rounded-bl text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remove image"
                  >
                    <CloseIcon size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Agent mode">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  role="radio"
                  aria-checked={selectedMode === mode.id}
                  onClick={() => {
                    haptics.select();
                    onModeChange(mode.id);
                  }}
                  className={`px-3 py-1.5 rounded text-[12px] font-medium transition-colors ${
                    selectedMode === mode.id
                      ? "bg-bg-active text-text"
                      : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {mode.label}
                </button>
              ))}

              <span className="hidden sm:inline text-[10px] text-text-muted/50 ml-2 select-none">
                Enter ↵ send · Shift+Enter newline
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative">
                <button
                  onClick={() => {
                    haptics.tap();
                    setModelOpen(!modelOpen);
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={modelOpen}
                  aria-label="Select model"
                  className="flex items-center gap-1 px-3 py-1.5 rounded text-[12px] text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
                >
                  {modelsLoading ? (
                    <Spinner className="w-2.5 h-2.5" />
                  ) : (
                    <span className="truncate max-w-[80px] sm:max-w-[150px]">{currentModelLabel}</span>
                  )}
                  <ChevronDown />
                </button>

                {modelOpen && models.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setModelOpen(false)} />
                    <div role="listbox" aria-label="Models" className="absolute bottom-full right-0 mb-1 z-50 w-56 bg-bg-elevated border border-border rounded-lg shadow-xl py-1 max-h-80 overflow-y-auto">
                      {autoModel && (
                        <ModelRow
                          key={autoModel.id}
                          model={autoModel}
                          selected={selectedModel === autoModel.id}
                          onSelect={() => {
                            onModelChange(autoModel.id);
                            setModelOpen(false);
                          }}
                        />
                      )}

                      {rest.length > 0 && (
                        <>
                          <div className="h-px bg-border mx-2 my-1" />
                          {rest.map((m) => (
                            <ModelRow
                              key={m.id}
                              model={m}
                              selected={selectedModel === m.id}
                              onSelect={() => {
                                onModelChange(m.id);
                                setModelOpen(false);
                              }}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              {isStreaming && (
                <button
                  onClick={handleStop}
                  className="p-2 rounded-md text-text-muted hover:text-text transition-colors"
                  aria-label="Stop streaming"
                >
                  <StopIcon />
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={(!value.trim() && images.length === 0) || uploading}
                className="p-2 rounded-md text-text-muted hover:text-text disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                aria-label={uploading ? "Uploading..." : isStreaming ? "Queue message" : "Send message"}
              >
                {uploading ? <Spinner className="w-4 h-4" /> : isStreaming ? <PlusIcon size={18} /> : <ArrowUp />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: ModelInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const haptics = useHaptics();
  return (
    <button
      role="option"
      aria-selected={selected}
      onClick={() => {
        haptics.select();
        onSelect();
      }}
      className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between gap-2 transition-colors ${
        selected
          ? "text-text bg-bg-active"
          : "text-text-secondary hover:bg-bg-hover hover:text-text"
      }`}
    >
      <span className="truncate">{model.label}</span>
      <span className="flex items-center gap-1 shrink-0">
        {model.isDefault && (
          <span className="text-[9px] px-1 py-px rounded bg-bg-hover text-text-secondary font-medium">
            default
          </span>
        )}
        {model.isCurrent && (
          <span className="text-[9px] px-1 py-px rounded bg-success/15 text-success font-medium">
            current
          </span>
        )}
      </span>
    </button>
  );
}

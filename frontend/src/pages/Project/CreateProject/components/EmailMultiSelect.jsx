import React, { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isLikelyEmail } from "@/utils/emailList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function addEmailTag(current, raw) {
  const t = String(raw).trim();
  if (!t || !isLikelyEmail(t)) return current;
  const lower = t.toLowerCase();
  if (current.some((e) => e.toLowerCase() === lower)) return current;
  return [...current, t];
}

/**
 * Tags + optional hub email picker (Popover) + manual typing. Shadcn-only UI.
 *
 * @param {object} props
 * @param {string} props.id - input id for labels
 * @param {string[]} props.value
 * @param {(next: string[]) => void} props.onChange
 * @param {string[]} [props.suggestions] - hub emails; empty = manual entry only
 * @param {boolean} [props.disabled]
 * @param {string} [props.error]
 * @param {string} [props.placeholder]
 */
export function EmailMultiSelect({
  id,
  value,
  onChange,
  suggestions = [],
  disabled = false,
  error,
  placeholder = "Type an email and press Enter…",
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const suggestionList = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = suggestions || [];
    if (!q) return base;
    return base.filter((e) => e.toLowerCase().includes(q));
  }, [suggestions, query]);

  const hasPicker = suggestions.length > 0;

  const commitDraft = () => {
    const next = addEmailTag(value, draft);
    if (next !== value) onChange(next);
    setDraft("");
  };

  const toggleSuggestion = (email) => {
    const lower = email.toLowerCase();
    const isOn = value.some((e) => e.toLowerCase() === lower);
    if (isOn) {
      onChange(value.filter((e) => e.toLowerCase() !== lower));
    } else {
      onChange(addEmailTag(value, email));
    }
  };

  const removeTag = (email) => {
    const lower = email.toLowerCase();
    onChange(value.filter((e) => e.toLowerCase() !== lower));
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
      return;
    }
    if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 shadow-xs",
          disabled && "cursor-not-allowed opacity-60",
          error && "border-destructive",
        )}
      >
        {value.map((email) => (
          <Badge
            key={email}
            variant="secondary"
            className="h-7 max-w-full gap-0.5 pr-0.5 font-normal rounded-sm"
          >
            <span className="max-w-[220px] truncate px-1">{email}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              disabled={disabled}
              onClick={() => removeTag(email)}
              aria-label={`Remove ${email}`}
            >
              <X className="size-3.5" />
            </Button>
          </Badge>
        ))}
        <Input
          id={id}
          disabled={disabled}
          placeholder={value.length ? "" : placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          className="min-w-[140px] flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 h-8 px-1"
        />
        {hasPicker && !disabled && (
          <Popover
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) setQuery("");
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                aria-label="Choose from hub emails"
              >
                <ChevronsUpDown className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[min(100vw-2rem,24rem)] p-0"
              align="end"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              {/* <Input
                placeholder="Filter emails…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="rounded-none border-0 border-b shadow-none focus-visible:ring-0"
                autoComplete="off"
              /> */}
              <div className="max-h-60 overflow-y-auto p-1">
                {suggestionList.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No matching emails
                  </p>
                ) : (
                  suggestionList.map((email) => {
                    const selected = value.some(
                      (e) => e.toLowerCase() === email.toLowerCase(),
                    );
                    return (
                      <button
                        key={email}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                          selected && "bg-accent/60",
                        )}
                        onClick={() => toggleSuggestion(email)}
                      >
                        <Check
                          className={cn(
                            "size-4 shrink-0 text-primary",
                            selected ? "opacity-100" : "opacity-20",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{email}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

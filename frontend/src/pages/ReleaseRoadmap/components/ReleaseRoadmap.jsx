import React, { useCallback, useMemo, useState } from "react";
import { format, startOfDay } from "date-fns";
import {
  CalendarDays,
  CheckCircle,
  ChevronDown,
  History,
  Lock,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { fetchReleaseChangelog } from "@/api";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { HubProfileAvatar } from "@/components/common/HubProfileAvatar";
import { cn, formatProjectVersionLabel } from "@/lib/utils";
import { sortReleasesByVersionName } from "@/lib/releaseVersionSort";

const ROADMAP_PAGE_SIZE = 10;

const RELEASE_STATUS_CHANGELOG_LABELS = {
  draft: "Draft",
  active: "Active",
  locked: "Locked",
  skip: "Skip",
};

const CHANGELOG_FIELD_LABELS = {
  status: "Status",
  releaseDate: "Target release",
  actualReleaseDate: "Actual release",
  actualReleaseNotes: "Actual release notes",
  startDate: "Start date",
  name: "Name",
  description: "Description",
  isMvp: "MVP",
  lockedBy: "Locked by",
  clientReleaseNote: "Client release note",
};

function formatReadableDate(value) {
  if (value == null || value === "") return "—";
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return format(d, "MMMM d, yyyy");
  } catch {
    return String(value);
  }
}

function formatChangelogTimestamp(iso) {
  if (!iso) return "";
  try {
    return format(new Date(iso), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function formatChangelogScalar(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const key = value.toLowerCase();
    if (RELEASE_STATUS_CHANGELOG_LABELS[value])
      return RELEASE_STATUS_CHANGELOG_LABELS[value];
    if (RELEASE_STATUS_CHANGELOG_LABELS[key])
      return RELEASE_STATUS_CHANGELOG_LABELS[key];
    if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value)))
      return formatReadableDate(value);
    return value;
  }
  return String(value);
}

function changelogFieldLabel(key) {
  return (
    CHANGELOG_FIELD_LABELS[key] ??
    key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())
  );
}

function parseDate(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeReleaseStatus(release) {
  const s = String(release?.status ?? "draft").toLowerCase();
  return ["draft", "active", "locked", "skip"].includes(s) ? s : "draft";
}

function isReleaseLocked(release) {
  return normalizeReleaseStatus(release) === "locked";
}

function releaseCardAccentBarClass(release) {
  switch (normalizeReleaseStatus(release)) {
    case "locked":
      return "bg-destructive";
    case "active":
      return "bg-primary";
    case "skip":
      return "bg-chart-4";
    default:
      return "bg-muted-foreground/50";
  }
}

function releaseStatusPresentation(release) {
  const s = normalizeReleaseStatus(release);
  if (s === "active") {
    return {
      label: "Active",
      hint: "Serves the live build when set as the active release",
      pillClass: "bg-primary/10 text-primary ring-1 ring-primary/25 shadow-sm",
      dotClass: "bg-primary ring-2 ring-primary/30",
    };
  }
  if (s === "locked") {
    return {
      label: "Locked",
      hint: "Cannot be unlocked here. View this release by choosing a version on the client link.",
      pillClass:
        "bg-destructive/10 text-destructive ring-1 ring-destructive/25 shadow-sm",
      dotClass: "bg-destructive ring-2 ring-destructive/30",
    };
  }
  if (s === "skip") {
    return {
      label: "Skip",
      hint: "Marked as not shipping this cycle — change status anytime if plans change",
      pillClass:
        "bg-chart-4/15 text-foreground ring-1 ring-chart-4/30 shadow-sm",
      dotClass: "bg-chart-4 ring-2 ring-chart-4/35",
    };
  }
  return {
    label: "Draft",
    hint: "Work in progress — safe to upload and iterate",
    pillClass: "bg-muted text-muted-foreground ring-1 ring-border",
    dotClass: "bg-muted-foreground",
  };
}

function comparePlanVsActual(plannedRaw, actualRaw) {
  const planned = parseDate(plannedRaw);
  const actual = parseDate(actualRaw);
  if (!actual) return "no_actual";
  if (!planned) return "no_planned";
  const p = startOfDay(planned).getTime();
  const a = startOfDay(actual).getTime();
  if (a > p) return "late";
  if (a < p) return "early";
  return "ontime";
}

/**
 * Vertical + cross-axis placement for the planned-date block vs actual badge (flex-col).
 * Late (actual after planned): planned top/start, actual bottom/end — reads “later” downward and outward.
 * Early: inverted. On time: centered both axes.
 */
function plannedCompareZoneClass(kind) {
  if (kind === "early") return "justify-end items-end";
  if (kind === "ontime" || kind === "no_planned")
    return "justify-center items-center";
  if (kind === "no_actual") return "justify-start items-start";
  return "justify-start items-start";
}

function actualCompareZoneClass(kind) {
  if (kind === "late") return "justify-end items-end";
  if (kind === "early") return "justify-start items-start";
  if (kind === "ontime" || kind === "no_planned")
    return "justify-center items-center";
  return "justify-center items-center";
}

/** Main-axis alignment for the planned header row (flex-row: accent, badge, dates, creator). */
function plannedCompareRowClass(kind) {
  if (kind === "early") return "justify-end";
  if (kind === "ontime" || kind === "no_planned") return "justify-center";
  return "justify-start";
}

function actualCompareInnerClass(kind) {
  if (kind === "late") return "items-end";
  if (kind === "early") return "items-start";
  if (kind === "ontime" || kind === "no_planned") return "items-center";
  return "items-center";
}

/** Pin the actual-release card in the grid row (compact height, no inner dead space). */
function actualReleaseCardAlignClass(kind) {
  if (kind === "late") return "w-full self-start md:self-end";
  if (kind === "early") return "w-full self-start";
  return "w-full self-start md:self-cetner";
}

/** Planned card vertical alignment in the grid row (md+). Early uses a spacer above the card so the top shifts down while actual stays top-aligned. */
function plannedReleaseCardAlignClass(kind) {
  if (kind === "late") return "w-full self-start";
  if (kind === "early") return "w-full";
  return "w-full self-start md:self-start";
}

function actualShipDateSurfaceClass(kind) {
  if (kind === "late")
    return "bg-gradient-to-br from-rose-500/[0.11] via-destructive/10 to-background ring-1 ring-destructive/20 shadow-sm shadow-destructive/5 dark:from-rose-950/40 dark:via-destructive/15";
  if (kind === "early")
    return "bg-gradient-to-br from-emerald-500/[0.1] via-chart-2/15 to-background ring-1 ring-emerald-500/25 shadow-sm shadow-emerald-500/5 dark:from-emerald-950/35";
  if (kind === "ontime")
    return "bg-gradient-to-br from-primary/[0.12] via-cyan-500/8 to-background ring-1 ring-primary/25 shadow-sm shadow-primary/10 dark:via-primary/10";
  return "bg-gradient-to-br from-muted/70 via-muted/45 to-muted/25 ring-1 ring-border/70 shadow-sm";
}

function actualShipDateAccentTextClass(kind) {
  if (kind === "late") return "text-destructive";
  if (kind === "early") return "text-chart-2";
  if (kind === "ontime") return "text-primary";
  return "text-muted-foreground";
}

function plannedDatesBlockSurfaceClass() {
  return "bg-gradient-to-br from-amber-400/20 via-yellow-400/12 to-background ring-1 ring-amber-400/35 shadow-sm shadow-amber-500/10 dark:from-amber-950/45 dark:via-yellow-950/30 dark:ring-amber-500/30";
}

function plannedDatesBlockAccentTextClass() {
  return "text-amber-800 dark:text-amber-400";
}

function ReleasePlannedPanel({
  release,
  compareKind,
  changelogEntries,
  changelogLoading,
  onChangelogOpen,
}) {
  const statusUi = releaseStatusPresentation(release);
  const status = normalizeReleaseStatus(release);
  const versions = Array.isArray(release.versions) ? release.versions : [];
  const changelogList = Array.isArray(changelogEntries) ? changelogEntries : [];

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2",
          plannedCompareZoneClass(compareKind),
        )}
      >
        <div
          className={cn(
            "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 sm:px-2.5 sm:py-2",
            plannedDatesBlockSurfaceClass(),
          )}
        >
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background/75 shadow-inner ring-1 ring-black/5 backdrop-blur-sm dark:bg-background/50 dark:ring-white/10"
            aria-hidden
          >
            <CalendarDays
              className={cn("size-3.5", plannedDatesBlockAccentTextClass())}
              aria-hidden
            />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p
              className={cn(
                "text-[9px] font-semibold uppercase tracking-wider",
                plannedDatesBlockAccentTextClass(),
              )}
            >
              Planned release dates
            </p>
            <div className="mt-0.5 min-w-0 truncate text-sm font-semibold leading-tight tracking-tight text-foreground">
              <time dateTime={release.startDate ?? undefined}>
                {formatReadableDate(release.startDate)}
              </time>
              <span className="mx-1 font-normal text-muted-foreground">→</span>
              <time dateTime={release.releaseDate ?? undefined}>
                {formatReadableDate(release.releaseDate)}
              </time>
            </div>
          </div>
        </div>
        <div
          className={cn(
            "flex w-full max-w-full min-w-0 flex-row flex-wrap items-center gap-2 text-xs sm:gap-2.5",
          )}
        >
          <div className="inline-flex min-w-0 shrink-0 items-center gap-2">
            <HubProfileAvatar
              email={release.creator?.email}
              alt={release.creator?.name ?? ""}
              className="size-5"
              fallbackClassName="rounded-md"
            />
            <span className="max-w-[10rem] truncate text-muted-foreground sm:max-w-[14rem]">
              {release.creator?.name ?? "—"}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  "h-5 shrink-0 cursor-default gap-1 rounded-full border-0 px-2 py-0 text-[10px] font-semibold leading-none",
                  statusUi.pillClass,
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    statusUi.dotClass,
                  )}
                  aria-hidden
                />
                {statusUi.label}
                {status === "active" && (
                  <Sparkles
                    className="size-3 shrink-0 text-primary/80"
                    aria-hidden
                  />
                )}
                {isReleaseLocked(release) && (
                  <Lock
                    className="size-3 shrink-0 text-destructive/80"
                    aria-hidden
                  />
                )}
              </Badge>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-[280px] text-left leading-snug"
            >
              {statusUi.hint}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3 pt-1">
        <Collapsible defaultOpen={false} className="min-w-0">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-left text-xs font-medium text-foreground ring-1 ring-border/60 transition-colors hover:bg-muted/60">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </span>
            <ChevronDown className="ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="rounded-xl bg-muted/40 px-3.5 py-3 ring-1 ring-border/60">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {release.description?.trim() ? (
                  release.description
                ) : (
                  <span className="italic">No description added yet.</span>
                )}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          onOpenChange={(open) => {
            if (open) onChangelogOpen?.();
          }}
          className="min-w-0"
        >
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-left text-xs font-medium text-foreground ring-1 ring-border/60 transition-colors hover:bg-muted/60">
            <History className="size-3.5 shrink-0 text-muted-foreground" />
            Change history
            <ChevronDown className="ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {changelogLoading ? (
              <div className="flex justify-center py-4">
                <Spinner className="size-6 text-primary" />
              </div>
            ) : (
              <ul className="max-h-80 space-y-3 overflow-y-auto pr-0.5">
                {changelogList.length === 0 ? (
                  <li className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
                    No changes recorded yet.
                  </li>
                ) : (
                  changelogList.map((log) => (
                    <li
                      key={log.id}
                      className="overflow-hidden rounded-lg border border-border/90 bg-card shadow-sm"
                    >
                      <div className="flex flex-col gap-1 border-b border-border bg-muted/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm font-semibold text-foreground">
                          {log.changedBy?.name ||
                            log.changedByEmail ||
                            "Unknown"}
                        </span>
                        <time
                          className="text-xs text-muted-foreground"
                          dateTime={log.createdAt}
                        >
                          {formatChangelogTimestamp(log.createdAt)}
                        </time>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Reason
                        </p>
                        <p className="mt-0.5 text-sm leading-relaxed text-foreground">
                          {log.reason}
                        </p>
                      </div>
                      {log.changes &&
                      typeof log.changes === "object" &&
                      Object.keys(log.changes).length > 0 ? (
                        <div className="border-t border-border px-2 py-2">
                          <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            What changed
                          </p>
                          <div className="overflow-x-auto rounded-md border border-border">
                            <table className="w-full min-w-[280px] text-left text-xs">
                              <thead>
                                <tr className="border-b border-border bg-muted/50 text-muted-foreground">
                                  <th className="px-2 py-1.5 font-semibold">
                                    Field
                                  </th>
                                  <th className="px-2 py-1.5 font-semibold">
                                    Before
                                  </th>
                                  <th className="px-2 py-1.5 font-semibold">
                                    After
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(log.changes).map(
                                  ([key, val]) => {
                                    const isDiff =
                                      val &&
                                      typeof val === "object" &&
                                      "from" in val &&
                                      "to" in val;
                                    return (
                                      <tr
                                        key={key}
                                        className="border-b border-border/60 last:border-0"
                                      >
                                        <td className="px-2 py-2 align-top font-medium text-foreground">
                                          {changelogFieldLabel(key)}
                                        </td>
                                        <td className="px-2 py-2 align-top text-muted-foreground">
                                          {isDiff
                                            ? formatChangelogScalar(val.from)
                                            : formatChangelogScalar(val)}
                                        </td>
                                        <td className="px-2 py-2 align-top text-foreground">
                                          {isDiff
                                            ? formatChangelogScalar(val.to)
                                            : "—"}
                                        </td>
                                      </tr>
                                    );
                                  },
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            )}
          </CollapsibleContent>
        </Collapsible>

        {versions.length > 0 ? (
          <Collapsible className="min-w-0 rounded-lg border border-border/80 bg-card ring-1 ring-border/60">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="group flex h-auto min-h-11 w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/50 data-[state=open]:rounded-b-none"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-sm font-medium text-foreground">
                    Revision history
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {versions.length} revision
                    {versions.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-sm">
                    <span className="text-muted-foreground">Latest </span>
                    <span className="font-medium text-foreground">
                      {formatProjectVersionLabel(versions[0]?.version)}
                    </span>
                  </span>
                </div>
                <ChevronDown className="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-2 border-t border-border p-3 pt-2">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className={cn(
                      "flex flex-col gap-2 rounded-lg border p-3 transition-colors sm:flex-row sm:items-center sm:justify-between",
                      version.isActive
                        ? "border-primary/40 bg-primary/10"
                        : "border-border/80 bg-card",
                    )}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <span className="font-mono text-sm font-medium text-foreground">
                          {formatProjectVersionLabel(version.version)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(version.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    {version.isActive ? (
                      <Badge className="w-fit shrink-0 bg-primary text-primary-foreground">
                        <CheckCircle className="size-3.5" aria-hidden />
                        Active
                      </Badge>
                    ) : null}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </div>
  );
}

function ReleaseActualPanel({ release, kind, hasActual }) {
  const accent = actualShipDateAccentTextClass(kind);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2",
          actualCompareZoneClass(kind),
        )}
      >
        <div
          className={cn(
            "flex w-full max-w-full flex-col gap-1.5",
            actualCompareInnerClass(kind),
          )}
        >
          {hasActual ? (
            <>
              <div
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 sm:px-2.5 sm:py-2",
                  actualShipDateSurfaceClass(kind),
                )}
              >
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background/75 shadow-inner ring-1 ring-black/5 backdrop-blur-sm dark:bg-background/50 dark:ring-white/10"
                  aria-hidden
                >
                  <CalendarDays
                    className={cn("size-3.5", accent)}
                    aria-hidden
                  />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p
                    className={cn(
                      "text-[9px] font-semibold uppercase tracking-wider",
                      accent,
                    )}
                  >
                    Actual release date
                  </p>
                  <time
                    className="mt-0.5 block min-w-0 truncate text-sm font-semibold leading-tight tracking-tight text-foreground"
                    dateTime={release.actualReleaseDate ?? undefined}
                  >
                    {formatReadableDate(release.actualReleaseDate)}
                  </time>
                </div>
              </div>
              {release.actualReleaseNotes?.trim() ? null : (
                <p className="w-fit max-w-full rounded-md bg-muted/50 px-2 py-0.5 text-[10px] italic leading-snug text-muted-foreground ring-1 ring-border/50">
                  No notes for this release.
                </p>
              )}
            </>
          ) : (
            <div className="text-center">
                <span className="text-sm font-medium text-muted-foreground">
                  Release not completed
                </span>
            </div>
          )}
        </div>
      </div>
      {hasActual && release.actualReleaseNotes?.trim() ? (
        <div className="relative overflow-hidden rounded-lg border border-border/50 bg-gradient-to-b from-muted/45 via-muted/30 to-muted/15 px-2.5 py-2 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <div
            className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
            aria-hidden
          />
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Actual release notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground/95">
            {release.actualReleaseNotes.trim()}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * @param {{ releases: Array<Record<string, unknown>> }} props
 */
export function ReleaseRoadmap({ releases }) {
  const [visibleCount, setVisibleCount] = useState(ROADMAP_PAGE_SIZE);
  const [changelogByRelease, setChangelogByRelease] = useState({});
  const [changelogLoadingId, setChangelogLoadingId] = useState(null);

  const loadChangelog = useCallback(async (releaseId) => {
    setChangelogLoadingId(releaseId);
    try {
      const data = await fetchReleaseChangelog(releaseId);
      setChangelogByRelease((prev) => ({
        ...prev,
        [releaseId]: Array.isArray(data) ? data : [],
      }));
    } catch (err) {
      toast.error(err?.error || err?.message || "Failed to load history");
    } finally {
      setChangelogLoadingId(null);
    }
  }, []);

  const requestChangelogIfNeeded = useCallback(
    (releaseId) => {
      if (
        changelogByRelease[releaseId] !== undefined ||
        changelogLoadingId === releaseId
      ) {
        return;
      }
      loadChangelog(releaseId);
    },
    [changelogByRelease, changelogLoadingId, loadChangelog],
  );

  const sorted = useMemo(
    () => sortReleasesByVersionName(Array.isArray(releases) ? releases : []),
    [releases],
  );

  const visible = useMemo(
    () => sorted.slice(0, visibleCount),
    [sorted, visibleCount],
  );

  const hasMore = visibleCount < sorted.length;

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No releases yet. Create a release to see the roadmap.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="shrink-0 pb-2 pt-0">
        <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_minmax(4.5rem,5.5rem)_minmax(0,1fr)] md:items-center md:gap-3">
          <div className="px-1 text-sm font-medium text-muted-foreground">
            Planned release
          </div>
          <div className="px-0.5 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Timeline
          </div>
          <div className="px-1 text-sm font-medium text-muted-foreground">
            Actual release
          </div>
        </div>
        <p className="text-xs text-muted-foreground md:hidden">
          Planned · timeline · actual
        </p>
      </div>

      <div className="py-2">
        <div className="space-y-5 pb-2">
          {visible.map((release, i) => {
            const kind = comparePlanVsActual(
              release.releaseDate,
              release.actualReleaseDate,
            );
            const hasActual = !!parseDate(release.actualReleaseDate);
            const isLastInList = i === visible.length - 1;

            return (
              <div
                key={release.id}
                className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(4.5rem,5.5rem)_minmax(0,1fr)] md:items-stretch md:gap-3"
              >
                <div className="flex w-full min-h-0 flex-col">
                  {kind === "early" ? (
                    <div
                      className="hidden shrink-0 md:block md:h-14 lg:h-[4.5rem]"
                      aria-hidden
                    />
                  ) : null}
                  <Card
                    className={cn(
                      "group relative overflow-hidden rounded-2xl border border-border/90 bg-card gap-0 py-0 shadow-sm shadow-black/[0.06] transition-all duration-200 hover:border-border hover:shadow-md dark:shadow-black/25 dark:hover:shadow-lg/15",
                      plannedReleaseCardAlignClass(kind),
                    )}
                  >
                    <div
                      className={cn(
                        "h-1 w-full shrink-0",
                        releaseCardAccentBarClass(release),
                      )}
                      aria-hidden
                    />
                    <div className="flex flex-col px-4 py-4 sm:px-5 sm:py-5">
                      <ReleasePlannedPanel
                        release={release}
                        compareKind={kind}
                        changelogEntries={changelogByRelease[release.id]}
                        changelogLoading={changelogLoadingId === release.id}
                        onChangelogOpen={() =>
                          requestChangelogIfNeeded(release.id)
                        }
                      />
                    </div>
                  </Card>
                </div>

                <div className="relative mx-auto flex w-full max-w-[5.5rem] flex-col items-stretch md:mx-0 md:max-w-none md:self-stretch">
                  {/* Node + name + MVP: solid bg hides any connector; line must not run through this block */}
                  <div className="relative z-20 flex w-full flex-col items-center gap-1 bg-card px-1 pb-1.5 pt-1 md:pt-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center md:h-11 md:w-11">
                      <div className="h-3.5 w-3.5 rounded-full bg-primary ring-[6px] ring-primary/20 md:h-4 md:w-4 md:ring-[7px]" />
                    </div>
                    <div className="flex w-full flex-col items-center gap-1 text-center">
                      <span className="max-w-full break-all text-base font-bold text-foreground">
                        {release.name}
                      </span>
                      {release.isMvp ? (  
                        <Badge className="h-5 shrink-0 border-0 px-1.5 py-0 text-[9px] font-bold uppercase leading-none tracking-wide text-primary-foreground bg-primary">
                          MVP
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {/* Connector only below the label stack (starts after name/MVP) */}
                  <div className="relative hidden min-h-0 w-full flex-1 md:block">
                    {!isLastInList ? (
                      <div
                        className="pointer-events-none absolute left-1/2 top-0 bottom-[-2.5rem] z-0 w-1 -translate-x-1/2 rounded-full bg-border"
                        aria-hidden
                      />
                    ) : null}
                    {isLastInList && visible.length > 1 ? (
                      <div
                        className="pointer-events-none absolute left-1/2 top-0 bottom-0 z-0 w-1 -translate-x-1/2 rounded-full bg-border"
                        aria-hidden
                      />
                    ) : null}
                  </div>
                </div>

                <Card
                  className={cn(
                    "group relative overflow-hidden rounded-xl border border-border/90 bg-card gap-0 py-0 shadow-sm shadow-black/6 transition-all duration-200 hover:border-border hover:shadow-md dark:shadow-black/25 dark:hover:shadow-lg/15",
                    actualReleaseCardAlignClass(kind),
                  )}
                >
                  <div className="flex flex-col px-3 py-3 sm:px-3.5 sm:py-3">
                    <ReleaseActualPanel
                      release={release}
                      kind={kind}
                      hasActual={hasActual}
                    />
                  </div>
                </Card>

                <Separator className="col-span-full md:hidden" />
              </div>
            );
          })}
        </div>

        {hasMore ? (
          <div className="flex justify-center pb-4 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-border"
              onClick={() =>
                setVisibleCount((c) =>
                  Math.min(c + ROADMAP_PAGE_SIZE, sorted.length),
                )
              }
            >
              Load more releases ({sorted.length - visibleCount} remaining)
            </Button>
          </div>
        ) : sorted.length > ROADMAP_PAGE_SIZE ? (
          <p className="pb-4 text-center text-xs text-muted-foreground">
            Showing all {sorted.length} releases
          </p>
        ) : null}
      </div>
    </div>
  );
}

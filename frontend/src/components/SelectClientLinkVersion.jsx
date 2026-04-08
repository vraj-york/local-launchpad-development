import { useState } from "react";
import { switchProjectVersion } from "@/api";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn, formatProjectVersionLabel } from "@/lib/utils";
import { Label } from "./ui/label";
import { Lock, Unlock } from "lucide-react";


/**
 * Version selector for Client Link page. Uses POST /:projectId/switch to get a
 * temporary preview buildUrl; parent should use buildUrl in iframe and refresh when it changes.
 */
export function SelectClientLinkVersion({
  release: releases = [],
  projectId,
  onSwitched,
  compact = false,
  selectLabel = "Choose Version :",
  darkTrigger = false,
}) {
  const [switching, setSwitching] = useState(false);
  const [selectedValue, setSelectedValue] = useState("");

  const getVersionById = (versionId) =>
    releases
      .flatMap((r) => r.versions || [])
      .find((v) => String(v.id) === String(versionId));

  const getReleaseByVersionId = (versionId) =>
    releases.find((r) =>
      (r.versions || []).some((v) => String(v.id) === String(versionId)),
    );

  const activeVersionId = releases
    .flatMap((r) => r.versions || [])
    .find((v) => v.isActive)?.id;

  const getVersionLabel = (version) =>
    formatProjectVersionLabel(version.version);

  /** R1 → "Revision 1"; otherwise same as getVersionLabel (e.g. v1.0.0). */
  const getRevisionLabelForDropdown = (versionStr) => {
    if (versionStr == null || versionStr === "") return "";
    const s = String(versionStr);
    const m = /^R(\d+)$/i.exec(s);
    if (m) return `Revision ${m[1]}`;
    return formatProjectVersionLabel(s);
  };

  /** "1.0.0" → "Release 1.0.0"; does not prefix if the name already starts with "Release". */
  const formatReleaseNameForDisplay = (name) => {
    const t = (name ?? "").trim();
    if (!t) return "";
    if (/^release(\s|$)/i.test(t)) return t;
    return `Release ${t}`;
  };

  const getFullVersionOptionLabel = (release, version) => {
    const rev = getRevisionLabelForDropdown(version.version);
    const rn = formatReleaseNameForDisplay(release?.name ?? "");
    if (rn && rev) return `${rn} - ${rev}`;
    if (rev) return rev;
    return getVersionLabel(version);
  };

  const handleValueChange = async (versionId) => {
    if (!versionId || !projectId) return;
    const versionObj = getVersionById(versionId);
    const rel = getReleaseByVersionId(versionId);
    const versionLabel = versionObj
      ? formatProjectVersionLabel(versionObj.version)
      : "version";
    const previewToastLabel =
      versionObj && rel
        ? getFullVersionOptionLabel(rel, versionObj)
        : versionObj
          ? getVersionLabel(versionObj)
          : versionLabel;

    try {
      setSwitching(true);
      setSelectedValue(versionId);
      const result = await switchProjectVersion(
        projectId,
        Number(versionId),
        false,
      );
      toast.success(`${previewToastLabel} preview ready`, {
        position: "bottom-right",
      });
      onSwitched?.({
        buildUrl: result?.buildUrl,
        version: result?.version,
        versionId: Number(versionId),
        releaseId: rel?.id != null ? Number(rel.id) : null,
      });
    } catch (err) {
      toast.error(err?.error ?? "Failed to switch version");
      setSelectedValue(activeVersionId ? String(activeVersionId) : "");
    } finally {
      setSwitching(false);
    }
  };

  const hasAnyVersions = releases.some(
    (r) => Array.isArray(r.versions) && r.versions.length > 0,
  );

  const isReleaseLocked = (r) =>
    String(r?.status ?? "").toLowerCase() === "locked";

  if (!hasAnyVersions) return null;

  const triggerClassName = cn(
    compact && "h-8 text-sm",
    darkTrigger &&
      "border-0 bg-gradient-to-r from-slate-700 to-slate-800 text-white font-bold shadow-sm [&_svg]:text-white [&_svg]:opacity-100 min-w-[140px]",
  );

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", compact && "gap-1.5")}
    >
      {!compact && !darkTrigger && <Label>{selectLabel}</Label>}
      {compact && darkTrigger && (
        <Label className="text-sm text-slate-700">{selectLabel}</Label>
      )}
      <Select
        value={
          selectedValue || (activeVersionId ? String(activeVersionId) : "")
        }
        onValueChange={handleValueChange}
        disabled={switching}
        className={compact ? "w-auto min-w-[120px]" : "w-full"}
      >
        <SelectTrigger className={triggerClassName}>
          {switching ? (
            <span className="flex items-center gap-2">
              <Spinner className="size-4" />
              Switching...
            </span>
          ) : (
            <SelectValue placeholder="Select version to preview">
              {(() => {
                const currentId =
                  selectedValue ||
                  (activeVersionId ? String(activeVersionId) : "");
                if (!currentId) return null;
                const version = getVersionById(currentId);
                const release = getReleaseByVersionId(currentId);
                const activeSuffix = version?.isActive ? " (Active)" : "";
                const main =
                  version && release
                    ? getFullVersionOptionLabel(release, version)
                    : version
                      ? getVersionLabel(version)
                      : "";
                return `${main}${activeSuffix}`;
              })()}
            </SelectValue>
          )}
        </SelectTrigger>
        <SelectContent
          position="popper"
          sideOffset={4}
          className={cn(
            "select-viewport-scrollbar max-h-[min(18rem,var(--radix-select-content-available-height))] min-h-0 max-w-[min(28rem,calc(100vw-1.5rem))]",
          )}
        >
          {releases.map((release) => {
            const versions = release.versions || [];
            if (versions.length === 0) return null;
            return (
              <SelectGroup key={release.id}>
                <div className={cn("flex items-center gap-2")}>
                  <SelectLabel
                    className={`${isReleaseLocked(release) ? "text-red-500" : "text-green-500"}`}
                  >
                    {formatReleaseNameForDisplay(release.name)}
                  </SelectLabel>{" "}
                  {isReleaseLocked(release) ? (
                    <Lock className="w-4 h-4 text-red-500" />
                  ) : (
                    <Unlock className="w-4 h-4 text-green-500" />
                  )}
                </div>
                {versions.map((version) => (
                  <SelectItem
                    key={version.id}
                    value={String(version.id)}
                    className={cn(
                      version.isActive &&
                        "bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground ",
                    )}
                  >
                    {getFullVersionOptionLabel(release, version)}
                    {version.isActive && " (Active)"}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
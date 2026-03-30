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
import { cn } from "@/lib/utils";
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

  const handleValueChange = async (versionId) => {
    if (!versionId || !projectId) return;
    const versionObj = getVersionById(versionId);
    const versionLabel = versionObj ? `v${versionObj.version}` : "version";

    try {
      setSwitching(true);
      setSelectedValue(versionId);
      const result = await switchProjectVersion(
        projectId,
        Number(versionId),
        false,
      );
      toast.success(
        (result?.version ? `v${result.version}` : versionLabel) +
          " preview ready",
        {
          position: "top-right",
        },
      );
      const rel = getReleaseByVersionId(versionId);
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

  const getVersionLabel = (version) => {
    return `v${version.version}`;
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
                const versionLabel = version ? getVersionLabel(version) : "";
                const releaseName = release?.name ?? "";
                const activeSuffix = version?.isActive ? " (Active)" : "";
                return releaseName
                  ? `${releaseName} – ${versionLabel}${activeSuffix}`
                  : `${versionLabel}${activeSuffix}`;
              })()}
            </SelectValue>
          )}
        </SelectTrigger>
        <SelectContent>
          {releases.map((release) => {
            const versions = release.versions || [];
            if (versions.length === 0) return null;
            return (
              <SelectGroup key={release.id}>
                <div className={cn("flex items-center gap-2")}>
                  <SelectLabel
                    className={`${isReleaseLocked(release) ? "text-red-500" : "text-green-500"}`}
                  >
                    {release.name}
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
                    {getVersionLabel(version)}
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
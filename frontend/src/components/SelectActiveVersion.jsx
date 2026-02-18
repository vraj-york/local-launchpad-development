import { useState } from "react";
import { activateReleaseVersions } from "@/api";
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

export function SelectActiveVersion({
  release: releases = [],
  projectId,
  onActivated,
}) {
  const [activating, setActivating] = useState(false);
  const [selectedValue, setSelectedValue] = useState("");

  const getVersionById = (versionId) =>
    releases
      .flatMap((r) => r.versions || [])
      .find((v) => String(v.id) === String(versionId));

  const handleValueChange = async (versionId) => {
    if (!versionId || !projectId) return;
    const versionObj = getVersionById(versionId);
    const versionName = versionObj ? `v${versionObj.version}` : "version";
    try {
      setActivating(true);
      await activateReleaseVersions(projectId, Number(versionId));
      toast.success(`${versionName} activated successfully`);
      setSelectedValue(versionId);
      onActivated?.();
    } catch (err) {
      toast.error(err.error || "Failed to activate version");
    } finally {
      setActivating(false);
    }
  };

  const getVersionLabel = (version) => {
    return `v${version.version}`;
  };

  const activeVersionId = releases
    .flatMap((r) => r.versions || [])
    .find((v) => v.isActive)?.id;

  const hasAnyVersions = releases.some(
    (r) => Array.isArray(r.versions) && r.versions.length > 0,
  );

  if (!hasAnyVersions) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label>Choose Version to Activate</Label>
      <Select
        value={
          selectedValue || (activeVersionId ? String(activeVersionId) : "")
        }
        onValueChange={handleValueChange}
        disabled={activating}
        className="w-full"
      >
        <SelectTrigger className="w-full">
          {activating ? (
            <span className="flex items-center gap-2">
              <Spinner className="size-4" />
              Activating...
            </span>
          ) : (
            <SelectValue placeholder="Select version to activate" />
          )}
        </SelectTrigger>
        <SelectContent>
          {releases.map((release) => {
            const versions = release.versions || [];
            if (versions.length === 0) return null;
            return (
              <SelectGroup key={release.id}>
                <SelectLabel>{release.name}</SelectLabel>
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

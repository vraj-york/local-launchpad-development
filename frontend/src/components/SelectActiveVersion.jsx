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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "./ui/button";
import { ExternalLink } from "lucide-react";

export function SelectActiveVersion({
  release: releases = [],
  projectId,
  onActivated,
}) {
  const [activating, setActivating] = useState(false);
  const [selectedValue, setSelectedValue] = useState("");
  const [pendingActivation, setPendingActivation] = useState(null);

  const getVersionById = (versionId) =>
    releases
      .flatMap((r) => r.versions || [])
      .find((v) => String(v.id) === String(versionId));

  const activeVersionId = releases
    .flatMap((r) => r.versions || [])
    .find((v) => v.isActive)?.id;

  const handleValueChange = (versionId) => {
    if (!versionId || !projectId) return;
    if (String(versionId) === String(activeVersionId)) return;
    const versionObj = getVersionById(versionId);
    const versionLabel = versionObj ? `v${versionObj.version}` : "version";
    setSelectedValue(versionId);
    setPendingActivation({
      versionId,
      versionLabel,
      buildUrl: versionObj?.buildUrl ?? null,
    });
  };

  const handleConfirmActivate = async () => {
    if (!pendingActivation?.versionId || !projectId) return;
    const { versionId, versionLabel } = pendingActivation;
    try {
      setActivating(true);
      await activateReleaseVersions(projectId, Number(versionId));
      toast.success(`${versionLabel} activated successfully`);
      setSelectedValue(versionId);
      setPendingActivation(null);
      onActivated?.();
    } catch (err) {
      toast.error(err.error || "Failed to activate version");
    } finally {
      setActivating(false);
    }
  };

  const handleCancelActivate = () => {
    setPendingActivation(null);
    setSelectedValue(activeVersionId ? String(activeVersionId) : "");
  };

  const getVersionLabel = (version) => {
    return `v${version.version}`;
  };

  const hasAnyVersions = releases.some(
    (r) => Array.isArray(r.versions) && r.versions.length > 0,
  );

  if (!hasAnyVersions) return null;

  return (
    <>
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

      <Dialog open={!!pendingActivation} onOpenChange={(open) => !open && handleCancelActivate()}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Activate {pendingActivation?.versionLabel}?
            </DialogTitle>
            <DialogDescription>
              Once activated, clients will see this version when they open
              their shared link.
            </DialogDescription>
          </DialogHeader>
          {pendingActivation?.buildUrl && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(pendingActivation.buildUrl, "_blank", "noopener,noreferrer")
                }
                className="hover:text-primary"
              >
                <ExternalLink />
                Verify Project Link
              </Button>
            </div>
          )}
          <DialogFooter showCloseButton={false} >
            <Button variant="outline" onClick={handleCancelActivate} disabled={activating}>
              Cancel
            </Button>
            <Button onClick={handleConfirmActivate} disabled={activating}>
              {activating ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-4" />
                  Activating...
                </span>
              ) : (
                "Activate"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

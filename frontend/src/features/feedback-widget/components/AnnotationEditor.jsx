import React, { useEffect, useMemo, useState } from "react";
import { Tldraw, exportToBlob } from "tldraw";
import { ArrowUp, Bug, TrendingUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import "tldraw/tldraw.css";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getClientLinkVerifiedEmail,
  isPlausibleClientLinkEmail,
} from "@/lib/clientLinkVerifiedEmail";

const ISSUE_TYPE_OPTIONS = [
  {
    value: "Improvements",
    label: "Improvements",
    icon: ArrowUp,
    iconBg: "bg-green-100",
    iconColor: "text-green-500",
  },
  {
    value: "Bug",
    label: "Bug",
    icon: Bug,
    iconBg: "bg-red-100",
    iconColor: "text-red-500",
  },
];

const AnnotationEditor = ({
  screenshot,
  metadata,
  onSave,
  requiresReporterEmail = false,
}) => {
  const [editor, setEditor] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("Bug");
  const [reporterEmail, setReporterEmail] = useState(() =>
    getClientLinkVerifiedEmail(),
  );
  const [error, setError] = useState("");

  const canSubmitFeedback = useMemo(() => {
    const emailNorm = reporterEmail.trim().toLowerCase();
    if (!requiresReporterEmail) {
      return !emailNorm || isPlausibleClientLinkEmail(emailNorm);
    }
    return Boolean(emailNorm && isPlausibleClientLinkEmail(emailNorm));
  }, [reporterEmail, requiresReporterEmail]);

  useEffect(() => {
    const stored = getClientLinkVerifiedEmail();
    if (stored) {
      setReporterEmail((prev) => (prev.trim() ? prev : stored));
    }
  }, [screenshot]);

  useEffect(() => {
    if (!editor || !screenshot) {
      return;
    }

    let isMounted = true;

    const loadScreenshot = async () => {
      try {
        setIsLoading(true);

        const img = new Image();
        img.src = screenshot;

        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        if (!isMounted) return;

        // Convert data URL to blob
        const response = await fetch(screenshot);
        const blob = await response.blob();
        const file = new File([blob], "screenshot.png", { type: "image/png" });

        // Use the editor's putExternalContent method to add the image
        await editor.putExternalContent({
          type: "files",
          files: [file],
          point: { x: 0, y: 0 },
          ignoreParent: false,
        });

        if (!isMounted) return;

        // Get the shape that was just created and lock it
        const shapes = editor.getCurrentPageShapes();
        const imageShape = shapes[shapes.length - 1];

        if (imageShape && imageShape.type === "image") {
          editor.updateShape({
            ...imageShape,
            isLocked: true,
          });
        }

        // Zoom to fit
        setTimeout(() => {
          if (isMounted && editor) {
            editor.zoomToFit({ duration: 200 });
            setIsLoading(false);
          }
        }, 100);
      } catch (error) {
        console.error("Failed to load screenshot:", error);
        setIsLoading(false);
      }
    };

    loadScreenshot();

    return () => {
      isMounted = false;
    };
  }, [editor, screenshot]);

  const handleSave = async () => {
    const emailNorm = reporterEmail.trim().toLowerCase();
    if (requiresReporterEmail) {
      if (!emailNorm) {
        setError("Please enter your email address.");
        return;
      }
      if (!isPlausibleClientLinkEmail(emailNorm)) {
        setError("Please enter a valid email address.");
        return;
      }
    } else if (emailNorm && !isPlausibleClientLinkEmail(emailNorm)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!description.trim()) {
      setError("Please provide a description");
      return;
    }

    if (description.trim().length < 10) {
      setError("Description must be at least 10 characters");
      return;
    }

    const emailForSubmit = emailNorm;

    if (!editor) {
      const response = await fetch(screenshot);
      const blob = await response.blob();
      onSave(blob, screenshot, description, issueType, emailForSubmit);
      return;
    }

    try {
      const shapeIds = Array.from(editor.getCurrentPageShapeIds());

      if (shapeIds.length === 0) {
        const response = await fetch(screenshot);
        const blob = await response.blob();
        onSave(blob, screenshot, description, issueType, emailForSubmit);
        return;
      }

      const blob = await exportToBlob({
        editor,
        ids: shapeIds,
        format: "png",
        opts: {
          background: true,
          bounds: editor.getCurrentPageBounds(),
          scale: 1,
        },
      });

      const reader = new FileReader();
      reader.onloadend = () => {
        onSave(blob, reader.result, description, issueType, emailForSubmit);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("Failed to export annotation:", error);
      const response = await fetch(screenshot);
      const blob = await response.blob();
      onSave(blob, screenshot, description, issueType, emailForSubmit);
    }
  };

  // Custom tldraw components to hide unwanted UI
  const components = {
    PageMenu: null, // Remove page menu
    NavigationPanel: null, // Remove navigation panel (zoom controls)
  };

  // Custom tools - only keep the ones we want
  const tools = [
    "select",
    "draw",
    "arrow",
    "rectangle",
    "ellipse",
    "text",
    "highlight",
  ];

  return (
    <div className="flex h-full min-h-[600px] gap-6">
      {/* Left side - tldraw editor */}
      <div className="relative min-w-0 flex-[1_1_65%]">
        {isLoading && (
          <div className="absolute left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-5 shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
            <div
              className="mx-auto mb-5 h-12 w-12 shrink-0 animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-gray-100 border-t-[#00b48a]"
              aria-hidden
            />
            <p className="mt-2.5 font-sans text-sm text-gray-500">
              Loading screenshot...
            </p>
          </div>
        )}

        <div
          className="h-full w-full overflow-hidden rounded-lg border-2 border-gray-200 bg-gray-50 [&_.tldraw]:rounded-lg [&_.tldraw_[data-testid='tools.note']]:!hidden [&_.tldraw_[data-testid='tools.eraser']]:!hidden [&_.tldraw_button[data-testid*='page']]:!hidden [&_.tldraw_.tlui-page-menu]:!hidden [&_.tldraw_.tlui-navigation-panel]:!hidden [&_.tldraw_[data-testid='tools.frame']]:!hidden"
        >
          <Tldraw onMount={setEditor} autoFocus components={components} />
        </div>
      </div>

      {/* Right side - Description form */}
      <div className="flex flex-col gap-4 flex-[0_0_35%]">
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold text-foreground leading-none">
            Describe the Issue
          </h3>
          <p className="text-sm text-muted-foreground">
            Use the tools on the left to edit the screenshot, then briefly
            describe the issue you’re facing.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-issue-type">
            Issue type <span className="text-destructive">*</span>
          </Label>
          <Select value={issueType} onValueChange={setIssueType}>
            <SelectTrigger id="feedback-issue-type" className="w-full px-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[1000001]" position="popper">
              {ISSUE_TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${opt?.iconBg}`}
                      >
                        <Icon className={`h-2 w-2 ${opt?.iconColor}`} />
                      </span>
                      {opt.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-reporter-email">
            Your email{" "}
            {requiresReporterEmail ? (
              <span className="text-destructive">*</span>
            ) : (
              <span className="text-muted-foreground font-normal">(optional)</span>
            )}
          </Label>
          <Input
            id="feedback-reporter-email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={reporterEmail}
            onChange={(e) => {
              setReporterEmail(e.target.value);
              setError("");
            }}
            className="w-full"
          />
        </div>

        <div className="flex flex-col space-y-2">
          <Label htmlFor="feedback-description">
            Description <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="feedback-description"
            placeholder="Please describe what you're seeing, what you expected, or any feedback you have..."
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setError("");
            }}
            maxLength={2000}
            className="min-h-[300px] resize-none"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {error && <span className="text-destructive">{error}</span>}
            </span>
            <span>{description.length}/2000</span>
          </div>
        </div>

        <Button
          type="button"
          onClick={handleSave}
          disabled={!canSubmitFeedback}
          title={
            !canSubmitFeedback
              ? requiresReporterEmail
                ? "Add a valid email address to submit."
                : "Enter a valid email address or clear the field."
              : undefined
          }
          className="w-fit"
        >
          Submit Feedback
        </Button>
      </div>
    </div>
  );
};

export default AnnotationEditor;

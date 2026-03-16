import React, { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";

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

const AnnotationEditor = ({ screenshot, metadata, onSave }) => {
  const [editor, setEditor] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("Bug");
  const [error, setError] = useState("");

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
    // Validate description
    if (!description.trim()) {
      setError("Please provide a description");
      return;
    }

    if (description.trim().length < 10) {
      setError("Description must be at least 10 characters");
      return;
    }

    if (!editor) {
      const response = await fetch(screenshot);
      const blob = await response.blob();
      onSave(blob, screenshot, description, issueType);
      return;
    }

    try {
      const shapeIds = Array.from(editor.getCurrentPageShapeIds());

      if (shapeIds.length === 0) {
        const response = await fetch(screenshot);
        const blob = await response.blob();
        onSave(blob, screenshot, description, issueType);
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
        onSave(blob, reader.result, description, issueType);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("Failed to export annotation:", error);
      const response = await fetch(screenshot);
      const blob = await response.blob();
      onSave(blob, screenshot, description, issueType);
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
    <div
      style={{
        display: "flex",
        gap: "24px",
        height: "100%",
        minHeight: "600px",
      }}
    >
      {/* Left side - tldraw editor */}
      <div style={{ flex: "1 1 65%", position: "relative" }}>
        {isLoading && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 1000,
              background: "white",
              padding: "20px",
              borderRadius: "8px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          >
            <div className="feedback-widget-spinner" />
            <p
              style={{ marginTop: "10px", fontSize: "14px", color: "#6b7280" }}
            >
              Loading screenshot...
            </p>
          </div>
        )}

        <div
          style={{
            width: "100%",
            height: "100%",
            border: "2px solid #e5e7eb",
            borderRadius: "8px",
            overflow: "hidden",
            background: "#f9fafb",
          }}
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

        <Button type="button" onClick={handleSave} className="w-fit">
          Submit Feedback
        </Button>
      </div>
    </div>
  );
};

export default AnnotationEditor;

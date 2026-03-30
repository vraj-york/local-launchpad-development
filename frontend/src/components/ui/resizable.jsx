import * as React from "react";
import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({ className, ...props }) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  );
}

function ResizablePanel({ className, ...props }) {
  return (
    <Panel data-slot="resizable-panel" className={cn(className)} {...props} />
  );
}

function ResizableHandle({ withHandle, className, ...props }) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px shrink-0 items-center justify-center bg-border",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
        className
      )}
      {...props}>
      {withHandle ? (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border bg-muted shadow-sm">
          <GripVertical className="size-2.5 text-muted-foreground" />
        </div>
      ) : null}
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };

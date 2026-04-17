"use client";

import { useWebHaptics } from "web-haptics/react";

export function useHaptics() {
  const { trigger } = useWebHaptics();

  return {
    tap: () => trigger("light"),
    send: () => trigger("success"),
    select: () => trigger("selection"),
    warn: () => trigger("warning"),
    error: () => trigger("error"),
  };
}

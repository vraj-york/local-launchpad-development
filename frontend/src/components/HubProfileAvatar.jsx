import React, { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { fetchHubProfilePicSignedUrl } from "../api/index";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Loads signed profile pic from Hub (by email) and shows Avatar with optional fallback image URL.
 */
export function HubProfileAvatar({
  email,
  alt = "",
  fallbackImageUrl,
  className,
  fallbackClassName,
  iconClassName = "size-[55%]",
}) {
  const [hubUrl, setHubUrl] = useState(null);

  useEffect(() => {
    const trimmed = typeof email === "string" ? email.trim() : "";
    if (!trimmed) {
      setHubUrl(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const next = await fetchHubProfilePicSignedUrl(trimmed);
      if (cancelled) return;
      setHubUrl(next);
    })();
    return () => {
      cancelled = true;
      setHubUrl(null);
    };
  }, [email]);

  const src = hubUrl || fallbackImageUrl || undefined;

  return (
    <Avatar className={cn(className)}>
      <AvatarImage src={src} alt={alt} />
      <AvatarFallback
        className={cn("bg-muted text-muted-foreground", fallbackClassName)}
      >
        <UserRound className={cn(iconClassName)} aria-hidden />
      </AvatarFallback>
    </Avatar>
  );
}

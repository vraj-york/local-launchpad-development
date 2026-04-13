import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { exchangeHubAuthCode, figmaComplete } from "@/api";
import config from "@/config";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

/** loading | figma_ok | error */
export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { checkAuth } = useAuth();
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const oauthErr = searchParams.get("error");
    const code = searchParams.get("code");

    if (oauthErr) {
      setPhase("error");
      setError(
        searchParams.get("error_description")?.replace(/\+/g, " ") || oauthErr,
      );
      return;
    }
    if (!code) {
      setPhase("error");
      setError("Missing sign-in code.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { token } = await exchangeHubAuthCode(
          code,
          config.HUB_OAUTH_REDIRECT_URL,
        );
        if (cancelled) return;

        checkAuth();
        const sk = "hub_oauth_figma_state";
        const figmaKey = sessionStorage.getItem(sk);
        sessionStorage.removeItem(sk);

        if (figmaKey) {
          const r = await figmaComplete(figmaKey, token);
          if (cancelled) return;
          if (r.error) {
            setPhase("error");
            setError(r.error);
            return;
          }
          setPhase("figma_ok");
          return;
        }
        navigate("/dashboard", { replace: true });
      } catch (e) {
        if (cancelled) return;
        const d = e?.response?.data;
        const msg =
          (typeof d?.message === "string" && d.message) ||
          (typeof d?.error === "string" && d.error) ||
          (typeof e?.message === "string" && e.message) ||
          "Sign-in failed";
        setPhase("error");
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate, checkAuth]);

  if (phase === "figma_ok") {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-gradient-to-br from-slate-50 via-muted/30 to-indigo-50/50 p-6 md:p-10">
        <Card className="w-full max-w-sm border-0 shadow-lg bg-card/95 backdrop-blur-sm">
          <CardHeader className="text-center space-y-1">
            <CardTitle className="text-xl text-green-600">
              Authentication complete
            </CardTitle>
            <CardDescription>
              You can close this window and return to Figma.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-gradient-to-br from-slate-50 via-muted/30 to-indigo-50/50 p-6">
        <Card className="w-full max-w-md border-0 shadow-lg bg-card/95 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-xl text-destructive">
              Sign-in failed
            </CardTitle>
            <CardDescription>Something went wrong.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <button
              type="button"
              className="text-sm text-primary underline"
              onClick={() => navigate("/login", { replace: true })}
            >
              Back to login
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-gradient-to-br from-slate-50 via-muted/30 to-indigo-50/50 p-6">
      <Card className="w-full max-w-sm border-0 shadow-lg bg-card/95 backdrop-blur-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Loader2 className="size-10 animate-spin text-primary" />
          </div>
          <CardTitle className="text-xl">Signing you in</CardTitle>
          <CardDescription>One moment…</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

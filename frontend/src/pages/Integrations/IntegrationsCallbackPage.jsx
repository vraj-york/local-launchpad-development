import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

/** Same rules as backend sanitizeOAuthReturnPath — internal SPA paths only. */
function safeOAuthReturnTo(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  if (/[\r\n\0]/.test(s)) return null;
  if (s.includes("://") || s.includes("\\") || s.includes("@")) return null;
  if (s.length > 512) return null;
  const q = s.indexOf("?");
  if (q === -1) return s;
  const path = s.slice(0, q);
  const query = s.slice(q + 1);
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (query.length > 256) return null;
  if (query && !/^[a-zA-Z0-9_=&.,%-]+$/.test(query)) return null;
  return s;
}

/**
 * OAuth return URL (GitHub / Bitbucket / Jira). Backend redirects here with ?provider=&ok=1 or ?error=
 */
const IntegrationsCallbackPage = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    const err = params.get("error");
    const provider = params.get("provider") || "integration";
    const ok = params.get("ok");
    const label =
      provider === "github"
        ? "GitHub"
        : provider === "bitbucket"
          ? "Bitbucket"
          : provider === "jira"
            ? "Jira"
            : "Integration";
    if (err) {
      toast.error(`${label}: ${decodeURIComponent(err)}`);
    } else if (ok === "1") {
      toast.success(`${label} connected`);
    }

    if (!user) {
      toast.error(
        "Session not found — log in again, then retry connecting GitHub, Bitbucket, or Jira.",
      );
      navigate("/login", { replace: true });
      return;
    }
    const returnTo = safeOAuthReturnTo(params.get("return_to"));
    navigate(returnTo || "/settings/integrations", { replace: true });
  }, [params, navigate, user, loading]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Finishing connection…
    </div>
  );
};

export default IntegrationsCallbackPage;

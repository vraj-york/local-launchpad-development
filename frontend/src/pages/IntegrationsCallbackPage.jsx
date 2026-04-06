import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

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
    navigate("/settings/integrations", { replace: true });
  }, [params, navigate, user, loading]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Finishing connection…
    </div>
  );
};

export default IntegrationsCallbackPage;

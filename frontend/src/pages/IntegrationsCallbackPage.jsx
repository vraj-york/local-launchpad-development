import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

/**
 * OAuth return URL (GitHub / Jira). Backend redirects here with ?provider=&ok=1 or ?error=
 */
const IntegrationsCallbackPage = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const err = params.get("error");
    const provider = params.get("provider") || "integration";
    const ok = params.get("ok");
    const label =
      provider === "github"
        ? "GitHub"
        : provider === "jira"
          ? "Jira"
          : "Integration";
    if (err) {
      toast.error(`${label}: ${decodeURIComponent(err)}`);
    } else if (ok === "1") {
      toast.success(`${label} connected`);
    }
    navigate("/settings/integrations", { replace: true });
  }, [params, navigate]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Finishing connection…
    </div>
  );
};

export default IntegrationsCallbackPage;

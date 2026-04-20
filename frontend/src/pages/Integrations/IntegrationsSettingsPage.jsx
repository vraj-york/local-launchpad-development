import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  disconnectBitbucketIntegration,
  disconnectFigmaIntegration,
  disconnectGithubIntegration,
  disconnectJiraIntegration,
  fetchCursorIntegrationStatus,
  fetchIntegrationsStatus,
  getBitbucketOAuthAuthorizeUrl,
  getFigmaOAuthAuthorizeUrl,
  getGithubOAuthAuthorizeUrl,
  getJiraOAuthAuthorizeUrl,
  syncCursorGithubPatFromOAuth,
} from "@/api";
import { toast } from "sonner";
import { Loader2, Unplug, Plus, RefreshCw, Cloud } from "lucide-react";
import githubMarkSvg from "@/assets/apps/GitHub.svg";
import bitbucketMarkSvg from "@/assets/apps/BitBucket.svg";
import jiraMarkSvg from "@/assets/apps/Jira.svg";
import figmaMarkSvg from "@/assets/apps/Figma.svg";
import { cn } from "@/lib/utils";

/** Brand mark for integration cards (matches ProjectGitJiraOAuthCard). */
function IntegrationBrandMark({ src, className, invertOnDark }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "pointer-events-none shrink-0 object-contain",
        invertOnDark && "dark:invert dark:opacity-90",
        className,
      )}
    />
  );
}

const IntegrationsSettingsPage = () => {
  const [status, setStatus] = useState(null);
  const [cursorStatus, setCursorStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [cursorBusy, setCursorBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, cursor] = await Promise.all([
        fetchIntegrationsStatus(),
        fetchCursorIntegrationStatus().catch(() => null),
      ]);
      setStatus(data);
      setCursorStatus(cursor);
    } catch (e) {
      console.error(e);
      toast.error("Could not load integration status");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCursorOnly = useCallback(async () => {
    setCursorBusy("refresh");
    try {
      const c = await fetchCursorIntegrationStatus();
      setCursorStatus(c);
      toast.success("Cursor connection status updated");
    } catch (e) {
      toast.error(e.response?.data?.error || "Could not load Cursor status");
      setCursorStatus(null);
    } finally {
      setCursorBusy(null);
    }
  }, []);

  const syncPatFromGithub = async () => {
    setCursorBusy("sync-oauth");
    try {
      await syncCursorGithubPatFromOAuth();
      toast.success("GitHub token registered for Cursor cloud agent");
      const c = await fetchCursorIntegrationStatus();
      setCursorStatus(c);
    } catch (e) {
      toast.error(e.response?.data?.error || e.message || "Could not sync token");
    } finally {
      setCursorBusy(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const ghList = status?.github?.connections ?? [];
  const bbList = status?.bitbucket?.connections ?? [];
  const jiList = status?.jira?.connections ?? [];
  const fgList = status?.figma?.connections ?? [];

  const connectGithubNew = async () => {
    setBusy("gh-new");
    try {
      window.location.href = await getGithubOAuthAuthorizeUrl();
    } catch (e) {
      toast.error(e.message || "Could not start GitHub OAuth");
      setBusy(null);
    }
  };

  const reconnectGithub = async (connectionId) => {
    setBusy(`gh-${connectionId}`);
    try {
      window.location.href = await getGithubOAuthAuthorizeUrl(connectionId);
    } catch (e) {
      toast.error(e.message || "Could not start GitHub OAuth");
      setBusy(null);
    }
  };

  const connectJiraNew = async () => {
    setBusy("ji-new");
    try {
      window.location.href = await getJiraOAuthAuthorizeUrl();
    } catch (e) {
      toast.error(e.message || "Could not start Jira OAuth");
      setBusy(null);
    }
  };

  const reconnectJira = async (connectionId) => {
    setBusy(`ji-${connectionId}`);
    try {
      window.location.href = await getJiraOAuthAuthorizeUrl(connectionId);
    } catch (e) {
      toast.error(e.message || "Could not start Jira OAuth");
      setBusy(null);
    }
  };

  const connectBitbucketNew = async () => {
    setBusy("bb-new");
    try {
      window.location.href = await getBitbucketOAuthAuthorizeUrl();
    } catch (e) {
      toast.error(e.message || "Could not start Bitbucket OAuth");
      setBusy(null);
    }
  };

  const reconnectBitbucket = async (connectionId) => {
    setBusy(`bb-${connectionId}`);
    try {
      window.location.href = await getBitbucketOAuthAuthorizeUrl(connectionId);
    } catch (e) {
      toast.error(e.message || "Could not start Bitbucket OAuth");
      setBusy(null);
    }
  };

  const disconnectBb = async (connectionId) => {
    setBusy(`disc-bb-${connectionId}`);
    try {
      await disconnectBitbucketIntegration(connectionId);
      toast.success("Bitbucket connection removed");
      await load();
    } catch {
      toast.error("Failed to disconnect Bitbucket");
    } finally {
      setBusy(null);
    }
  };

  const disconnectGh = async (connectionId) => {
    setBusy(`disc-gh-${connectionId}`);
    try {
      await disconnectGithubIntegration(connectionId);
      toast.success("GitHub connection removed");
      await load();
    } catch {
      toast.error("Failed to disconnect GitHub");
    } finally {
      setBusy(null);
    }
  };

  const disconnectJi = async (connectionId) => {
    setBusy(`disc-ji-${connectionId}`);
    try {
      await disconnectJiraIntegration(connectionId);
      toast.success("Jira connection removed");
      await load();
    } catch {
      toast.error("Failed to disconnect Jira");
    } finally {
      setBusy(null);
    }
  };

  const connectFigmaNew = async () => {
    setBusy("fg-new");
    try {
      window.location.href = await getFigmaOAuthAuthorizeUrl();
    } catch (e) {
      toast.error(e.message || "Could not start Figma OAuth");
      setBusy(null);
    }
  };

  const reconnectFigma = async (connectionId) => {
    setBusy(`fg-${connectionId}`);
    try {
      window.location.href = await getFigmaOAuthAuthorizeUrl(connectionId);
    } catch (e) {
      toast.error(e.message || "Could not start Figma OAuth");
      setBusy(null);
    }
  };

  const disconnectFg = async (connectionId) => {
    setBusy(`disc-fg-${connectionId}`);
    try {
      await disconnectFigmaIntegration(connectionId);
      toast.success("Figma connection removed");
      await load();
    } catch {
      toast.error("Failed to disconnect Figma");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="container mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect GitHub, Bitbucket, Jira, and Figma (REST API). Each project picks one code host (GitHub or Bitbucket) plus Jira. Signing in again with an account you already linked refreshes that connection instead of adding a duplicate."
      />
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <Cloud className="size-6 shrink-0 text-muted-foreground" aria-hidden />
                <CardTitle className="text-lg">Cursor cloud agent</CardTitle>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(cursorBusy)}
                onClick={refreshCursorOnly}
              >
                {cursorBusy === "refresh" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="mr-1 h-4 w-4" />
                    Check connection
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Registers your GitHub token with the Cursor cloud agent service so agents can clone and push
                using your account. Connect GitHub below first, then use &quot;Sync from GitHub&quot;.
              </p>
              {cursorStatus?.lastError && !cursorStatus?.reachable ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                  {cursorStatus.lastError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={Boolean(cursorBusy) || !cursorStatus?.hasGithubOAuth}
                  onClick={syncPatFromGithub}
                  title={
                    cursorStatus?.hasGithubOAuth
                      ? undefined
                      : "Add a GitHub account in the section below first"
                  }
                >
                  {cursorBusy === "sync-oauth" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Sync from GitHub"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <IntegrationBrandMark src={githubMarkSvg} invertOnDark className="size-6" />
                <CardTitle className="text-lg">GitHub</CardTitle>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={connectGithubNew}
              >
                {busy === "gh-new" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1 h-4 w-4" />
                    Add account
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {ghList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No GitHub accounts connected.</p>
              ) : (
                <ul className="space-y-3">
                  {ghList.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                    >
                      <div className="text-sm">
                        <span className="font-medium text-foreground">
                          {c.label || c.login || `Connection #${c.id}`}
                        </span>
                        {c.login ? (
                          <span className="text-muted-foreground"> · @{c.login}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() => reconnectGithub(c.id)}
                        >
                          {busy === `gh-${c.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Reconnect"
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={Boolean(busy)}
                          onClick={() => disconnectGh(c.id)}
                        >
                          {busy === `disc-gh-${c.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Unplug className="mr-1 h-4 w-4" />
                              Remove
                            </>
                          )}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <IntegrationBrandMark src={bitbucketMarkSvg} className="size-6" />
                <CardTitle className="text-lg">Bitbucket</CardTitle>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={connectBitbucketNew}
              >
                {busy === "bb-new" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1 h-4 w-4" />
                    Add account
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {bbList.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No Bitbucket accounts connected.
                </p>
              ) : (
                <ul className="space-y-3">
                  {bbList.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                    >
                      <div className="text-sm">
                        <span className="font-medium text-foreground">
                          {c.label || c.login || `Connection #${c.id}`}
                        </span>
                        {c.login ? (
                          <span className="text-muted-foreground"> · {c.login}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() => reconnectBitbucket(c.id)}
                        >
                          {busy === `bb-${c.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Reconnect"
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={Boolean(busy)}
                          onClick={() => disconnectBb(c.id)}
                        >
                          {busy === `disc-bb-${c.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Unplug className="mr-1 h-4 w-4" />
                              Remove
                            </>
                          )}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <IntegrationBrandMark src={jiraMarkSvg} className="size-6" />
                <CardTitle className="text-lg">Jira (Atlassian)</CardTitle>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={connectJiraNew}
              >
                {busy === "ji-new" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1 h-4 w-4" />
                    Add site
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {jiList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Jira sites connected.</p>
              ) : (
                <ul className="space-y-3">
                  {jiList.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                    >
                      <div className="text-sm break-all">
                        <span className="font-medium text-foreground">
                          {c.label || c.baseUrl || `Connection #${c.id}`}
                        </span>
                        {c.accountEmail ? (
                          <span className="text-muted-foreground"> · {c.accountEmail}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() => reconnectJira(c.id)}
                        >
                          {busy === `ji-${c.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Reconnect"
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={Boolean(busy)}
                          onClick={() => disconnectJi(c.id)}
                        >
                          {busy === `disc-ji-${c.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Unplug className="mr-1 h-4 w-4" />
                              Remove
                            </>
                          )}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <IntegrationBrandMark src={figmaMarkSvg} className="size-6" />
                <CardTitle className="text-lg">Figma</CardTitle>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={connectFigmaNew}
              >
                {busy === "fg-new" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1 h-4 w-4" />
                    Add account
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Links your Figma account for REST API access (separate from the Figma plugin login flow).
              </p>
              {fgList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Figma accounts connected.</p>
              ) : (
                <ul className="space-y-3">
                  {fgList.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0 text-sm">
                        <span className="font-medium text-foreground">
                          {c.label || c.handle || `Connection #${c.id}`}
                        </span>
                        {c.email ? (
                          <span className="block break-all text-muted-foreground">{c.email}</span>
                        ) : null}
                        {c.figmaUserId ? (
                          <span className="block break-all text-muted-foreground">
                            ID {c.figmaUserId}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() => reconnectFigma(c.id)}
                        >
                          {busy === `fg-${c.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Reconnect"
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={Boolean(busy)}
                          onClick={() => disconnectFg(c.id)}
                        >
                          {busy === `disc-fg-${c.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Unplug className="mr-1 h-4 w-4" />
                              Remove
                            </>
                          )}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default IntegrationsSettingsPage;

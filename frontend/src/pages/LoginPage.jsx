import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import { googleLogin, figmaComplete } from "../api";
import config from "../config";
import { isTokenExpired } from "../utils/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import logo from "../assets/launchpad-logo-svg.svg";

const clientId =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "516448789962-jhsndv38lfpdt30h334j8khu825fried.apps.googleusercontent.com";

function getFigmaState() {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state");
  return state && state.trim() ? state.trim() : null;
}
const HUB_API_URL = config.HUB_API_URL || import.meta.env.VITE_HUB_API_URL;

const LoginPage = () => {
  const { user, checkAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [figmaState, setFigmaState] = useState(null);
  const [figmaDone, setFigmaDone] = useState(false);
  const [autoCompletingFigma, setAutoCompletingFigma] = useState(false);
  const [handlingCallback, setHandlingCallback] = useState(false);

  useEffect(() => {
    setFigmaState(getFigmaState());
  }, []);

  // Handle callback from Hub: ?code=... after Google redirect
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (!code || handlingCallback) return;

    setHandlingCallback(true);
    setLoading(true);
    setError("");

    exchangeHubAuthCode(code)
      .then(({ token }) => {
        checkAuth();
        const state = getFigmaState();
        const cleanUrl =
          window.location.pathname + (state ? `?state=${state}` : "");
        window.history.replaceState({}, "", cleanUrl);
        if (state) {
          figmaComplete(state, token).then((complete) => {
            if (complete.error) setError(complete.error);
            else setFigmaDone(true);
          });
        } else {
          navigate("/dashboard");
        }
      })
      .catch((err) => {
        setError(err?.error || "Google sign-in failed");
      })
      .finally(() => {
        setLoading(false);
        setHandlingCallback(false);
      });
  }, [location.search]);

  useEffect(() => {
    const state = getFigmaState();
    if (!state) return;
    const token = localStorage.getItem("token");
    if (!token || isTokenExpired(token)) return;
    setAutoCompletingFigma(true);
    setError("");
    figmaComplete(state, token)
      .then((complete) => {
        if (complete.error) {
          setError(complete.error);
        } else {
          setFigmaDone(true);
        }
      })
      .catch(() => setError("Failed to connect to Figma."))
      .finally(() => setAutoCompletingFigma(false));
  }, []);

  useEffect(() => {
    if (user && !figmaState) {
      navigate("/dashboard");
    }
  }, [user, figmaState, navigate]);

  const handleGoogleSuccess = async (credentialResponse) => {
    setLoading(true);
    setError("");
    try {
      const result = await googleLogin(credentialResponse.credential);
      if (result.token && result.user) {
        checkAuth();
        if (figmaState) {
          const complete = await figmaComplete(figmaState, result.token);
          if (complete.error) {
            setError(complete.error);
          } else {
            setFigmaDone(true);
          }
        } else {
          navigate("/dashboard");
        }
      }
    } catch (err) {
      setError("Google Login Failed");
    }
    setLoading(false);
  };

  const handleGoogleFailure = () => {
    setError("Google Login Failed");
  };

  const handleGoogleSignIn = async () => {
    const apiUrl = `${HUB_API_URL}/api/auth/google`;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl);
      const json = await res.json();
      const authUrl = json?.data?.url;
      if (!authUrl) {
        setError("Invalid response from sign-in service");
        return;
      }
      window.location.href = authUrl;
    } catch (err) {
      setError("Could not start Google sign-in. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (figmaDone) {
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

  if (autoCompletingFigma) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-gradient-to-br from-slate-50 via-muted/30 to-indigo-50/50 p-6 md:p-10">
        <Card className="w-full max-w-sm border-0 shadow-lg bg-card/95 backdrop-blur-sm">
          <CardHeader className="text-center space-y-1">
            <div className="flex justify-center mb-4">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
            <CardTitle className="text-xl">Connecting to Figma</CardTitle>
            <CardDescription>Using your existing login…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-gradient-to-br from-slate-50 via-muted/30 to-indigo-50/50 p-6 md:p-10">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <a
            href="/"
            className="flex items-center gap-2 self-center font-medium text-foreground no-underline hover:opacity-90"
          >
            <img src={logo} alt="launchpad logo" className="w-36" />
          </a>
          <Card className="border-0 shadow-lg bg-card/95 backdrop-blur-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Welcome back</CardTitle>
              <CardDescription>
                {figmaState
                  ? "Sign in to connect your Figma plugin."
                  : "Continue with your Google account"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                {error && (
                  <Alert variant="destructive" className="rounded-lg">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {/* <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={handleGoogleFailure}
                  useOneTap
                  render={(renderProps) => (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={renderProps.onClick}
                      disabled={renderProps.disabled || loading}
                    >
                      {loading ? (
                        <Loader2 className="size-5 animate-spin shrink-0" />
                      ) : (
                        <GoogleIcon />
                      )}
                      {loading ? "Signing in…" : "Continue with Google"}
                    </Button>
                  )}
                /> */}
                <Button
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="flex items-center gap-2 w-full"
                  variant="outline"
                >
                  {loading ? (
                    <Loader2 className="size-5 animate-spin shrink-0" />
                  ) : (
                    <img
                      className="h-4"
                      src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48cGF0aCBkPSJNMTcuNiA5LjJsLS4xLTEuOEg5djMuNGg0LjhDMTMuNiAxMiAxMyAxMyAxMiAxMy42djIuMmgzYTguOCA4LjggMCAwIDAgMi42LTYuNnoiIGZpbGw9IiM0Mjg1RjQiIGZpbGwtcnVsZT0ibm9uemVybyIvPjxwYXRoIGQ9Ik05IDE4YzIuNCAwIDQuNS0uOCA2LTIuMmwtMy0yLjJhNS40IDUuNCAwIDAgMS04LTIuOUgxVjEzYTkgOSAwIDAgMCA4IDV6IiBmaWxsPSIjMzRBODUzIiBmaWxsLXJ1bGU9Im5vbnplcm8iLz48cGF0aCBkPSJNNCAxMC43YTUuNCA1LjQgMCAwIDEgMC0zLjRWNUgxYTkgOSAwIDAgMCAwIDhsMy0yLjN6IiBmaWxsPSIjRkJCQzA1IiBmaWxsLXJ1bGU9Im5vbnplcm8iLz48cGF0aCBkPSJNOSAzLjZjMS4zIDAgMi41LjQgMy40IDEuM0wxNSAyLjNBOSA5IDAgMCAwIDEgNWwzIDIuNGE1LjQgNS40IDAgMCAxIDUtMy43eiIgZmlsbD0iI0VBNDMzNSIgZmlsbC1ydWxlPSJub256ZXJvIi8+PHBhdGggZD0iTTAgMGgxOHYxOEgweiIvPjwvZz48L3N2Zz4="
                      alt=""
                    />
                  )}
                  <div>{loading ? "Signing in…" : "Sign in with Google"}</div>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </GoogleOAuthProvider>
  );
};

export default LoginPage;

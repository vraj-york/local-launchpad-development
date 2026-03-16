import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { googleLogin, registerUser, loginUser, figmaComplete } from "../api";
import { isTokenExpired } from "../utils/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const LoginPage = () => {
  const { user, login, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("login");
  const [credentials, setCredentials] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "manager",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [figmaState, setFigmaState] = useState(null);
  const [figmaDone, setFigmaDone] = useState(false);
  const [autoCompletingFigma, setAutoCompletingFigma] = useState(false);

  useEffect(() => {
    setFigmaState(getFigmaState());
  }, []);

  // When redirected from Figma with ?state= and user is already logged in, send stored token to complete the flow
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const isLogin = activeTab === "login";

    try {
      if (isLogin) {
        if (figmaState) {
          const { token, user: userData } = await loginUser({
            email: credentials.email,
            password: credentials.password,
          });
          const complete = await figmaComplete(figmaState, token);
          if (complete.error) {
            setError(complete.error);
          } else {
            checkAuth();
            setFigmaDone(true);
          }
        } else {
          const result = await login({
            email: credentials.email,
            password: credentials.password,
          });
          if (result.success) {
            navigate("/dashboard");
          } else {
            setError(result.error);
          }
        }
      } else {
        // Registration
        if (credentials.password !== credentials.confirmPassword) {
          setError("Passwords do not match");
          setLoading(false);
          return;
        }

        await registerUser({
          name: credentials.name,
          email: credentials.email,
          password: credentials.password,
          role: credentials.role,
        });

        // Auto-login after registration
        const result = await login({
          email: credentials.email,
          password: credentials.password,
        });

        if (result.success) {
          if (figmaState) {
            const token = localStorage.getItem("token");
            if (token) {
              const complete = await figmaComplete(figmaState, token);
              if (complete.error) {
                setError(complete.error);
              } else {
                setFigmaDone(true);
              }
            } else {
              setError(
                "Login succeeded but could not complete Figma connection.",
              );
            }
          } else {
            navigate("/dashboard");
          }
        } else {
          setError(
            "Registration successful, but login failed. Please try logging in.",
          );
        }
      }
    } catch (err) {
      setError(err.error || "An error occurred");
    }

    setLoading(false);
  };

  const handleChange = (e) => {
    setCredentials({
      ...credentials,
      [e.target.name]: e.target.value,
    });
  };

  const handleSelectChange = (value) => {
    setCredentials({
      ...credentials,
      role: value,
    });
  };

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

  if (figmaDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-xl font-bold text-green-600">
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
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-4">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
            <CardTitle className="text-xl font-bold">
              Connecting to Figma
            </CardTitle>
            <CardDescription>Using your existing login…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-4">
              <img
                src={logo}
                alt="Zip Sync Logo"
                className="w-[200px] h-auto block"
              />
            </div>
            <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
            <CardDescription>
              {figmaState
                ? "Sign in to connect your Figma plugin."
                : activeTab === "login"
                  ? "Enter your credentials to access your account"
                  : "Create a new account to get started"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
              </TabsList>

              {error && (
                <Alert variant="destructive" className="mb-6">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit}>
                <TabsContent value="login" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      name="email"
                      type="email"
                      placeholder="name@example.com"
                      value={credentials.email}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      name="password"
                      type="password"
                      placeholder="Enter your password"
                      value={credentials.password}
                      onChange={handleChange}
                      required
                    />
                  </div>
                </TabsContent>

                <TabsContent value="register" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="register-name">Full Name</Label>
                    <Input
                      id="register-name"
                      name="name"
                      type="text"
                      placeholder="John Doe"
                      value={credentials.name}
                      onChange={handleChange}
                      required={activeTab === "register"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-email">Email</Label>
                    <Input
                      id="register-email"
                      name="email"
                      type="email"
                      placeholder="name@example.com"
                      value={credentials.email}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-password">Password</Label>
                    <Input
                      id="register-password"
                      name="password"
                      type="password"
                      placeholder="Create a password"
                      value={credentials.password}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm Password</Label>
                    <Input
                      id="confirm-password"
                      name="confirmPassword"
                      type="password"
                      placeholder="Confirm your password"
                      value={credentials.confirmPassword}
                      onChange={handleChange}
                      required={activeTab === "register"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select
                      value={credentials.role}
                      onValueChange={handleSelectChange}
                    >
                      <SelectTrigger id="role">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </TabsContent>

                <Button
                  className="w-full mt-6"
                  type="submit"
                  disabled={loading}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {activeTab === "login" ? "Sign In" : "Create Account"}
                </Button>
              </form>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-muted-foreground">
                    Or continue with
                  </span>
                </div>
              </div>
              <div className="flex justify-center w-full">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={handleGoogleFailure}
                  useOneTap
                />
              </div>
            </Tabs>
          </CardContent>
          <CardFooter className="flex flex-col justify-center text-center text-sm text-gray-500">
            <p className="font-semibold mb-2">Demo Credentials:</p>
            <p>Admin: admin@example.com / admin123</p>
            <p>Manager: manager@example.com / manager123</p>
          </CardFooter>
        </Card>
      </div>
    </GoogleOAuthProvider>
  );
};

export default LoginPage;

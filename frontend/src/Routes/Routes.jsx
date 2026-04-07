import {
  BrowserRouter,
  Navigate,
  Route,
  Routes as RouterRoutes,
} from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import LoginPage from "../pages/LoginPage";
import AuthCallbackPage from "../pages/AuthCallbackPage";
import { MainLayout } from "@/layouts/MainLayout";
import ProjectDetails from "@/pages/ProjectDetails";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import CreateProject from "@/pages/CreateProject";
import IntegrationsCallbackPage from "@/pages/IntegrationsCallbackPage";
import IntegrationsSettingsPage from "@/pages/IntegrationsSettingsPage";
import { ClientLink } from "@/pages/ClientLink";
import ReleaseRoadmapPage from "@/pages/ReleaseRoadmapPage";

export const Routes = () => {
  const { user, loading } = useAuth();

  const publicRoutes = [
    { path: "/login", element: <LoginPage />, publicOnly: false },
    {
      path: "/auth/callback",
      element: <AuthCallbackPage />,
      publicOnly: false,
    },
    {
      path: "/integrations/callback",
      element: <IntegrationsCallbackPage />,
      publicOnly: false,
    },
  ];

  const privateRoutes = [
    { path: "/dashboard", element: <Dashboard /> },
    { path: "/projects", element: <Projects /> },
    { path: "/projects/new", element: <CreateProject /> },
    { path: "/projects/details/:projectId", element: <ProjectDetails /> },
    {
      path: "/projects/roadmap/:projectId",
      element: <ReleaseRoadmapPage />,
    },
    { path: "/settings/integrations", element: <IntegrationsSettingsPage /> },
  ];

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <RouterRoutes>
        {publicRoutes.map((route, index) => (
          <Route
            key={index}
            path={route.path}
            element={
              route.publicOnly === false ? (
                route.element
              ) : !user ? (
                route.element
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
        ))}

        <Route element={<MainLayout />}>
          {privateRoutes.map((route, index) => (
            <Route
              key={index}
              path={route.path}
              element={user ? route.element : <Navigate to="/login" replace />}
            />
          ))}
        </Route>

        <Route path="/projects/:projectSlug" element={<ClientLink />} />

        <Route
          path="*"
          element={<Navigate to={user ? "/dashboard" : "/login"} replace />}
        />
      </RouterRoutes>
    </BrowserRouter>
  );
};

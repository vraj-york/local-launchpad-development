import { BrowserRouter, Navigate, Route, Routes as RouterRoutes, } from 'react-router-dom'
import { useAuth } from '../context/AuthContext';
import LoginPage from '../pages/LoginPage';
import Dashboard from '../components/Dashboard';
import GitDiff from '../components/GitDiff';

export const Routes = () => {

    const { user, loading } = useAuth();

    const publicRoutes = [
        { path: "/login", element: <LoginPage /> },
    ]

    const privateRoutes = [
        { path: "/dashboard", element: <Dashboard /> },
        { path: "/projects/:projectId/diff", element: <GitDiff /> },
    ]


    if (loading) {
        return <div>Loading...</div>;
    }

  return (
    <BrowserRouter>
      <RouterRoutes>
        {publicRoutes.map((route, index) => (
            <Route 
                key={index} 
                path={route.path} 
                element={!user ? route.element : <Navigate to="/dashboard" replace />} 
            />
        ))}

        {privateRoutes.map((route, index) => (
            <Route 
                key={index} 
                path={route.path} 
                element={user ? route.element : <Navigate to="/login" replace />} 
            />
        ))}

        <Route path="*" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
      </RouterRoutes>
    </BrowserRouter>
  )
}

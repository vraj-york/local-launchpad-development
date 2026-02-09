
import { AuthProvider } from './context/AuthContext';
import { Toaster } from "@/components/ui/sonner"
import { Routes } from './routes/Routes';
import { GoogleOAuthProvider } from '@react-oauth/google';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "516448789962-jhsndv38lfpdt30h334j8khu825fried.apps.googleusercontent.com"; // Fallback for dev


const App = () => {
  return (
    <GoogleOAuthProvider clientId={clientId}>
      <AuthProvider>
        <Routes />
        <Toaster />
      </AuthProvider>
    </GoogleOAuthProvider>
  );
};

export default App;
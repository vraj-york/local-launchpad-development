
import { AuthProvider } from './context/AuthContext';
import { Toaster } from "@/components/ui/sonner"
import { Routes } from './Routes/Routes';

const App = () => {
  return (
    <AuthProvider>
      <Routes />
      <Toaster />
    </AuthProvider>
  );
};

export default App;
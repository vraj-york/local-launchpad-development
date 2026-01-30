
import { AuthProvider } from './context/AuthContext';

// import './styles/main.css';
import { Toaster } from "@/components/ui/sonner"
import { Routes } from './routes/Routes';

const App = () => {
  return (
    <AuthProvider>
      <Routes />
      <Toaster />
    </AuthProvider>
  );
};

export default App;
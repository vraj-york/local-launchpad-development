
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
// import './styles/main.css';
import { Routes } from './routes/Routes';

const App = () => {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes />
      </ToastProvider>
    </AuthProvider>
  );
};

export default App;
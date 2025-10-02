import React, { createContext, useContext, useState } from 'react';
import Toast from '../components/Toast';

const ToastContext = createContext();

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const addToast = (message, type = 'info', duration = 5000) => {
        const id = Date.now() + Math.random();
        const newToast = { id, message, type, duration };
        
        setToasts(prev => [...prev, newToast]);
        
        // Auto remove after duration
        if (duration > 0) {
            setTimeout(() => {
                removeToast(id);
            }, duration);
        }
        
        return id;
    };

    const removeToast = (id) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    };

    const showSuccess = (message, duration = 5000) => {
        return addToast(message, 'success', duration);
    };

    const showError = (message, duration = 7000) => {
        return addToast(message, 'error', duration);
    };

    const showWarning = (message, duration = 6000) => {
        return addToast(message, 'warning', duration);
    };

    const showInfo = (message, duration = 5000) => {
        return addToast(message, 'info', duration);
    };

    const clearAll = () => {
        setToasts([]);
    };

    return (
        <ToastContext.Provider value={{
            addToast,
            removeToast,
            showSuccess,
            showError,
            showWarning,
            showInfo,
            clearAll
        }}>
            {children}
            {toasts.map(toast => (
                <Toast
                    key={toast.id}
                    message={toast.message}
                    type={toast.type}
                    duration={0} // We handle duration in the context
                    onClose={() => removeToast(toast.id)}
                />
            ))}
        </ToastContext.Provider>
    );
};

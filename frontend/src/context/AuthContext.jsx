import React, { createContext, useState, useEffect } from 'react';
import {
    loginUser,
    tryProactiveRefresh,
    startTokenRefreshTimer,
    stopTokenRefreshTimer,
    hubLogout,
    clearAuthStorageOnly,
} from '../api/index';
import { googleLogout } from '@react-oauth/google';
import { isTokenExpired } from '../utils/auth';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const clearAuthStorage = () => {
        stopTokenRefreshTimer();
        clearAuthStorageOnly();
        setUser(null);
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const storedUser = localStorage.getItem('user');
            const token = localStorage.getItem('token');

            if (storedUser && token) {
                if (isTokenExpired(token)) {
                    const refreshed = await tryProactiveRefresh();
                    if (cancelled) return;
                    if (refreshed) {
                        try {
                            const u = localStorage.getItem('user');
                            if (u) setUser(JSON.parse(u));
                        } catch {
                            clearAuthStorage();
                        }
                    } else {
                        clearAuthStorage();
                    }
                } else {
                    try {
                        setUser(JSON.parse(storedUser));
                    } catch (error) {
                        clearAuthStorage();
                    }
                }
            }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []);

    const login = async (credentials) => {
        try {
            const { user: userData, token } = await loginUser(credentials);
            setUser(userData);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.error || 'Login failed' };
        }
    };

    const logout = async () => {
        googleLogout();
        stopTokenRefreshTimer();
        await hubLogout();
        clearAuthStorageOnly();
        setUser(null);
    };

    const checkAuth = async () => {
        const storedUser = localStorage.getItem('user');
        const token = localStorage.getItem('token');
        if (!storedUser || !token) {
            clearAuthStorage();
            return;
        }
        if (isTokenExpired(token)) {
            const refreshed = await tryProactiveRefresh();
            if (refreshed) {
                try {
                    const u = localStorage.getItem('user');
                    if (u) setUser(JSON.parse(u));
                } catch {
                    clearAuthStorage();
                }
            } else {
                clearAuthStorage();
            }
            return;
        }
        try {
            setUser(JSON.parse(storedUser));
        } catch (error) {
            clearAuthStorage();
        }
    };

    useEffect(() => {
        if (user && localStorage.getItem('cognito_refresh_token')) {
            startTokenRefreshTimer();
        }
        return () => stopTokenRefreshTimer();
    }, [user]);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, checkAuth }}>
            {children}
        </AuthContext.Provider>
    );
};

// Custom hook to use auth context
export const useAuth = () => {
    const context = React.useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
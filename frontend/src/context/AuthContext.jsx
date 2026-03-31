import React, { createContext, useState, useEffect } from 'react';
import {
    tryProactiveRefresh,
    startTokenRefreshTimer,
    stopTokenRefreshTimer,
    hubLogout,
    clearAuthStorageOnly,
    clearLegacyLocalStorageKeys,
} from '../api/index';
import { isTokenExpired } from '../utils/auth';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const normalizeStoredUser = (rawUser) => {
        if (!rawUser || typeof rawUser !== 'object') return null;
        return {
            id: rawUser.id ?? null,
            role: rawUser.role ?? null,
            email: typeof rawUser.email === 'string' ? rawUser.email : '',
            name: typeof rawUser.name === 'string' ? rawUser.name : '',
        };
    };

    const clearAuthStorage = () => {
        stopTokenRefreshTimer();
        clearAuthStorageOnly();
        setUser(null);
    };

    useEffect(() => {
        clearLegacyLocalStorageKeys();
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
                            if (u) {
                                const normalizedUser = normalizeStoredUser(JSON.parse(u));
                                if (normalizedUser) {
                                    localStorage.setItem('user', JSON.stringify(normalizedUser));
                                    setUser(normalizedUser);
                                }
                            }
                        } catch {
                            clearAuthStorage();
                        }
                    } else {
                        clearAuthStorage();
                    }
                } else {
                    try {
                        const normalizedUser = normalizeStoredUser(JSON.parse(storedUser));
                        if (normalizedUser) {
                            localStorage.setItem('user', JSON.stringify(normalizedUser));
                            setUser(normalizedUser);
                        } else {
                            clearAuthStorage();
                        }
                    } catch (error) {
                        clearAuthStorage();
                    }
                }
            }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []);


    const logout = async () => {
        stopTokenRefreshTimer();
        try {
            await hubLogout();
        } finally {
            clearAuthStorageOnly();
            setUser(null);
        }
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
                    if (u) {
                        const normalizedUser = normalizeStoredUser(JSON.parse(u));
                        if (normalizedUser) {
                            localStorage.setItem('user', JSON.stringify(normalizedUser));
                            setUser(normalizedUser);
                        }
                    }
                } catch {
                    clearAuthStorage();
                }
            } else {
                clearAuthStorage();
            }
            return;
        }
        try {
            const normalizedUser = normalizeStoredUser(JSON.parse(storedUser));
            if (normalizedUser) {
                localStorage.setItem('user', JSON.stringify(normalizedUser));
                setUser(normalizedUser);
            } else {
                clearAuthStorage();
            }
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
        <AuthContext.Provider value={{ user, loading,logout, checkAuth }}>
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
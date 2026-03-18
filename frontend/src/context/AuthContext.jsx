import React, { createContext, useState, useEffect } from 'react';
import { loginUser } from '../api/index';
import { googleLogout } from '@react-oauth/google';
import { isTokenExpired } from '../utils/auth';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const clearAuthStorage = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('token_source');
        setUser(null);
    };

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        const token = localStorage.getItem('token');

        if (storedUser && token) {
            if (isTokenExpired(token)) {
                clearAuthStorage();
            } else {
                try {
                    setUser(JSON.parse(storedUser));
                } catch (error) {
                    clearAuthStorage();
                }
            }
        }
        setLoading(false);
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

    const logout = () => {
        googleLogout();
        clearAuthStorage();
    };

    const checkAuth = () => {
        const storedUser = localStorage.getItem('user');
        const token = localStorage.getItem('token');
        if (!storedUser || !token || isTokenExpired(token)) {
            clearAuthStorage();
            return;
        }
        try {
            setUser(JSON.parse(storedUser));
        } catch (error) {
            clearAuthStorage();
        }
    };

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
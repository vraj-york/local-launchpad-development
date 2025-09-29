import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { registerUser } from '../api';

const LoginPage = () => {
    const { user, login } = useAuth();
    const navigate = useNavigate();
    const [isLogin, setIsLogin] = useState(true);
    const [credentials, setCredentials] = useState({ 
        name: '', 
        email: '', 
        password: '', 
        confirmPassword: '',
        role: 'manager'
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (user) {
            navigate('/dashboard');
        }
    }, [user, navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            if (isLogin) {
                const result = await login({
                    email: credentials.email,
                    password: credentials.password
                });
                
                if (result.success) {
                    navigate('/dashboard');
                } else {
                    setError(result.error);
                }
            } else {
                // Registration
                if (credentials.password !== credentials.confirmPassword) {
                    setError('Passwords do not match');
                    setLoading(false);
                    return;
                }

                await registerUser({
                    name: credentials.name,
                    email: credentials.email,
                    password: credentials.password,
                    role: credentials.role
                });

                // Auto-login after registration
                const result = await login({
                    email: credentials.email,
                    password: credentials.password
                });
                
                if (result.success) {
                    navigate('/dashboard');
                } else {
                    setError('Registration successful, but login failed. Please try logging in.');
                }
            }
        } catch (err) {
            setError(err.error || 'An error occurred');
        }
        
        setLoading(false);
    };

    const handleChange = (e) => {
        setCredentials({
            ...credentials,
            [e.target.name]: e.target.value
        });
    };

    return (
        <div className="login-container">
            <div className="login-card">
               
                <div>
                    <img 
                        src="/logo.png" 
                        alt="Zip Sync Logo" 
                        style={{ width: '200px', display: 'block', margin: '0 auto 10px' }} 
                    />
                </div>
                <p style={{ textAlign: 'center', color: '#6c757d', marginBottom: '30px' }}>
                    {isLogin ? 'Sign in to your account' : 'Create a new account'}
                </p>

                {/* Toggle between login and register */}
                <div style={{ 
                    display: 'flex', 
                    marginBottom: '20px', 
                    background: '#f8f9fa', 
                    borderRadius: '8px',
                    padding: '4px'
                }}>
                    <button
                        type="button"
                        onClick={() => setIsLogin(true)}
                        style={{
                            flex: 1,
                            padding: '8px 16px',
                            border: 'none',
                            borderRadius: '6px',
                            background: isLogin ? '#00B48B' : 'transparent',
                            color: isLogin ? 'white' : '#6c757d',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        Login
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsLogin(false)}
                        style={{
                            flex: 1,
                            padding: '8px 16px',
                            border: 'none',
                            borderRadius: '6px',
                            background: !isLogin ? '#00B48B' : 'transparent',
                            color: !isLogin ? 'white' : '#6c757d',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        Register
                    </button>
                </div>
                
                {error && (
                    <div style={{ 
                        background: '#f8d7da', 
                        color: '#721c24', 
                        padding: '12px 16px', 
                        borderRadius: '8px', 
                        marginBottom: '20px',
                        border: '1px solid #f5c6cb'
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    {!isLogin && (
                        <div className="form-group">
                            <label className="form-label">Full Name</label>
                            <input
                                type="text"
                                name="name"
                                className="form-input"
                                value={credentials.name}
                                onChange={handleChange}
                                placeholder="Enter your full name"
                                required={!isLogin}
                            />
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">Email</label>
                        <input
                            type="email"
                            name="email"
                            className="form-input"
                            value={credentials.email}
                            onChange={handleChange}
                            placeholder="Enter your email"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <input
                            type="password"
                            name="password"
                            className="form-input"
                            value={credentials.password}
                            onChange={handleChange}
                            placeholder="Enter your password"
                            required
                        />
                    </div>

                    {!isLogin && (
                        <>
                            <div className="form-group">
                                <label className="form-label">Confirm Password</label>
                                <input
                                    type="password"
                                    name="confirmPassword"
                                    className="form-input"
                                    value={credentials.confirmPassword}
                                    onChange={handleChange}
                                    placeholder="Confirm your password"
                                    required={!isLogin}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Role</label>
                                <select
                                    name="role"
                                    className="form-input"
                                    value={credentials.role}
                                    onChange={handleChange}
                                    required={!isLogin}
                                >
                                    <option value="manager">Manager</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                        </>
                    )}

                    <button 
                        type="submit" 
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '10px' }}
                        disabled={loading}
                    >
                        {loading ? (isLogin ? 'Signing in...' : 'Creating account...') : (isLogin ? 'Sign In' : 'Create Account')}
                    </button>
                </form>

                <div style={{ 
                    textAlign: 'center', 
                    marginTop: '20px', 
                    fontSize: '14px', 
                    color: '#6c757d' 
                }}>
                    <p>Demo Credentials:</p>
                    <p><strong>Admin:</strong> admin@example.com / admin123</p>
                    <p><strong>Manager:</strong> manager@example.com / manager123</p>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
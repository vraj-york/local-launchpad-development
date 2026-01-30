import React, { useEffect, useState } from 'react';
import { getProjectVersions, activateVersion } from '../api';
import { useAuth } from '../context/AuthContext';

const ProjectVersions = ({ projectId, projectName }) => {
    const { user } = useAuth();
    const [versions, setVersions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activating, setActivating] = useState(null);

    useEffect(() => {
        if (projectId) {
            loadVersions();
        } else {
            setLoading(false);
        }
    }, [projectId]);

    const loadVersions = async () => {
        try {
            setLoading(true);
            const data = await getProjectVersions(projectId);
            setVersions(data);
        } catch (err) {
            setError(err.error || 'Failed to load versions');
        } finally {
            setLoading(false);
        }
    };

    const handleActivateVersion = async (versionId) => {
        try {
            setActivating(versionId);
            await activateVersion(projectId, versionId);
            await loadVersions(); // Refresh versions
        } catch (err) {
            setError(err.error || 'Failed to activate version');
        } finally {
            setActivating(null);
        }
    };

    const canManageVersions = user?.role === 'admin' || user?.role === 'manager';

    if (loading) {
        return (
            <div className="loading">
                <div className="spinner"></div>
                Loading versions...
            </div>
        );
    }

    if (!projectId) {
        return (
            <div>
                <div style={{ marginBottom: '24px' }}>
                    <h1 style={{ fontSize: '28px', fontWeight: '600', color: '#2c3e50', marginBottom: '8px' }}>
                        Version History
                    </h1>
                    <p style={{ color: '#6c757d', fontSize: '16px' }}>
                        Select a project from the "View Projects" section to see its version history.
                    </p>
                </div>
                <div className="card">
                    <div className="card-body">
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z" />
                                </svg>
                            </div>
                            <h3>No Project Selected</h3>
                            <p>Please select a project from the "View Projects" section to see its version history.</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '28px', fontWeight: '600', color: '#2c3e50', marginBottom: '8px' }}>
                    Project Versions
                </h1>
                <p style={{ color: '#6c757d', fontSize: '16px' }}>
                    Manage versions for: <strong>{projectName}</strong>
                </p>
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

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">All Versions ({versions.length})</h3>
                </div>
                <div className="card-body">
                    {versions.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                                </svg>
                            </div>
                            <h3>No Versions Found</h3>
                            <p>Upload your first build to create a version.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {versions.map((version) => (
                                <div
                                    key={version.id}
                                    style={{
                                        padding: '20px',
                                        border: '1px solid #e9ecef',
                                        borderRadius: '12px',
                                        background: version.isActive ? '#e7f3ff' : '#ffffff',
                                        borderColor: version.isActive ? '#b3d9ff' : '#e9ecef'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <div>
                                            <h4 style={{
                                                fontSize: '18px',
                                                fontWeight: '600',
                                                color: '#2c3e50',
                                                margin: '0 0 4px 0',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                                Version {version.version}
                                                {version.isActive && (
                                                    <span style={{
                                                        padding: '2px 8px',
                                                        borderRadius: '12px',
                                                        fontSize: '12px',
                                                        fontWeight: '500',
                                                        color: '#00B48B',
                                                        backgroundColor: '#d4edda'
                                                    }}>
                                                        Active
                                                    </span>
                                                )}
                                            </h4>
                                            <p style={{ color: '#6c757d', fontSize: '14px', margin: '0' }}>
                                                Uploaded by {version.uploader.name} on {new Date(version.createdAt).toLocaleDateString()}
                                            </p>
                                        </div>

                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            {version.buildUrl && (
                                                <a
                                                    href={version.buildUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="btn btn-primary"
                                                    style={{ fontSize: '12px', padding: '6px 12px' }}
                                                >
                                                    View Live
                                                </a>
                                            )}

                                            {canManageVersions && !version.isActive && (
                                                <button
                                                    className="btn btn-outline"
                                                    style={{ fontSize: '12px', padding: '6px 12px' }}
                                                    onClick={() => handleActivateVersion(version.id)}
                                                    disabled={activating === version.id}
                                                >
                                                    {activating === version.id ? 'Activating...' : 'Activate'}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {version.buildUrl && (
                                        <div style={{
                                            marginTop: '12px',
                                            padding: '8px',
                                            background: '#f8f9fa',
                                            borderRadius: '6px',
                                            border: '1px solid #e9ecef'
                                        }}>
                                            <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>
                                                Live URL:
                                            </div>
                                            <div style={{
                                                fontSize: '12px',
                                                color: '#0066cc',
                                                wordBreak: 'break-all',
                                                fontFamily: 'monospace'
                                            }}>
                                                {version.buildUrl}
                                            </div>
                                        </div>
                                    )}

                                    <div style={{
                                        marginTop: '12px',
                                        fontSize: '12px',
                                        color: '#6c757d',
                                        display: 'flex',
                                        justifyContent: 'space-between'
                                    }}>
                                        <span>Version ID: {version.id}</span>
                                        <span>Created: {new Date(version.createdAt).toLocaleString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProjectVersions;

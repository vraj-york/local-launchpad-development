import React from 'react';
import { useAuth } from '../context/AuthContext';

const ProjectUpload = () => {
    const { user } = useAuth();

    const canUpload = user?.role === 'admin' || user?.role === 'manager';

    if (!canUpload) {
        return (
            <div className="card">
                <div className="card-body">
                    <div className="empty-state">
                        <div className="empty-state-icon">
                            <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,16.5L6.5,12L7.91,10.59L11,13.67L16.59,8.09L18,9.5L11,16.5Z" />
                            </svg>
                        </div>
                        <h3>Access Denied</h3>
                        <p>You don't have permission to upload projects. Only admins and managers can upload builds.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '28px', fontWeight: '600', color: '#2c3e50', marginBottom: '8px' }}>
                    Project Upload
                </h1>
                <p style={{ color: '#6c757d', fontSize: '16px' }}>
                    Upload functionality has been moved to Release Management
                </p>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">New Upload Process</h3>
                </div>
                <div className="card-body">
                    <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
                        <h4 style={{ marginBottom: '12px', color: '#2c3e50' }}>How to upload projects now:</h4>
                        <ol style={{ paddingLeft: '20px', marginBottom: '16px' }}>
                            <li style={{ marginBottom: '8px' }}>Go to <strong>Project Management</strong> tab</li>
                            <li style={{ marginBottom: '8px' }}>Click <strong>"Manage Releases"</strong> on any project</li>
                            <li style={{ marginBottom: '8px' }}>Create a new release with a name and description</li>
                            <li style={{ marginBottom: '8px' }}>Upload ZIP files to the release (while it's unlocked)</li>
                            <li style={{ marginBottom: '8px' }}>Lock the release when you're done uploading</li>
                            <li>Create a new release for future uploads</li>
                        </ol>

                        <div style={{
                            padding: '12px',
                            background: '#d1ecf1',
                            borderRadius: '8px',
                            border: '1px solid #bee5eb',
                            color: '#0c5460'
                        }}>
                            <strong>Benefits of the new system:</strong>
                            <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                                <li>Better organization with releases</li>
                                <li>Version control and release management</li>
                                <li>Lock releases to prevent accidental changes</li>
                                <li>Clear separation between different project versions</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectUpload;

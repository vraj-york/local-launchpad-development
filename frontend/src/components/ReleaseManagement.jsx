import React, { useEffect, useState } from 'react';
import { fetchReleases, createRelease, toggleReleaseLock, uploadToRelease } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const ReleaseManagement = ({ projectId, projectName }) => {
    const { user } = useAuth();
    const { showSuccess, showError, showInfo, showWarning } = useToast();
    const [releases, setReleases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [selectedRelease, setSelectedRelease] = useState('');
    const [uploadFile, setUploadFile] = useState(null);
    const [version, setVersion] = useState('');
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadStatus, setUploadStatus] = useState('');

    const [newRelease, setNewRelease] = useState({
        name: '',
        description: ''
    });

    useEffect(() => {
        if (projectId) {
            loadReleases();
        }
    }, [projectId]);

    const loadReleases = async () => {
        try {
            setLoading(true);
            const data = await fetchReleases(projectId);
            setReleases(data);
        } catch (err) {
            setError(err.message || 'Failed to load releases');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRelease = async (e) => {
        e.preventDefault();
        if (!newRelease.name.trim()) return;

        try {
            setCreating(true);
            showInfo('Creating release...');
            await createRelease({
                projectId,
                name: newRelease.name.trim(),
                description: newRelease.description.trim() || null
            });
            setNewRelease({ name: '', description: '' });
            setShowCreateForm(false);
            await loadReleases();
            showSuccess(`Release "${newRelease.name}" created successfully!`);
        } catch (err) {
            const errorMessage = err.message || 'Failed to create release';
            setError(errorMessage);
            showError(`Failed to create release: ${errorMessage}`);
        } finally {
            setCreating(false);
        }
    };

    const handleLockToggle = async (releaseId, currentLockStatus) => {
        try {
            await toggleReleaseLock(releaseId, !currentLockStatus);
            await loadReleases();
        } catch (err) {
            setError(err.message || 'Failed to toggle release lock');
        }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
                setUploadFile(file);
                setUploadStatus('');
            } else {
                setUploadStatus('Please select a ZIP file');
                setUploadFile(null);
            }
        }
    };

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!selectedRelease || !uploadFile) return;

        try {
            setUploading(true);
            setUploadStatus('Uploading and building project...');
            setUploadProgress(0);
            showInfo('Uploading and building project...');

            // Simulate progress
            const progressInterval = setInterval(() => {
                setUploadProgress(prev => {
                    if (prev >= 90) {
                        clearInterval(progressInterval);
                        return prev;
                    }
                    return prev + 10;
                });
            }, 500);

            const result = await uploadToRelease(selectedRelease, uploadFile, version || null);

            clearInterval(progressInterval);
            setUploadProgress(100);

            setUploadStatus(`✅ Upload successful! Version: ${result.version.version} - Build URL: ${result.buildUrl}`);
            setUploadFile(null);
            setSelectedRelease('');
            setVersion('');
            document.getElementById('file-input').value = '';
            await loadReleases();
            showSuccess(`Project uploaded successfully! Version: ${result.version.version}`);
        } catch (err) {
            const errorMessage = err.error || err.message || 'Upload failed';
            setUploadStatus(`❌ Upload failed: ${errorMessage}`);
            showError(`Upload failed: ${errorMessage}`);
        } finally {
            setUploading(false);
        }
    };

    const canManageReleases = user?.role === 'admin' || user?.role === 'manager';

    if (loading) {
        return (
            <div className="loading">
                <div className="spinner"></div>
                Loading releases...
            </div>
        );
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2 style={{ fontSize: '24px', fontWeight: '600', color: '#2c3e50', marginBottom: '8px' }}>
                        Release Management - {projectName}
                    </h2>
                    <p style={{ color: '#6c757d', fontSize: '16px' }}>
                        Manage releases and upload ZIP files
                    </p>
                </div>
                {canManageReleases && (
                    <button 
                        className="btn btn-primary"
                        onClick={() => setShowCreateForm(true)}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                        </svg>
                        Create Release
                    </button>
                )}
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

            {/* Create Release Form */}
            {showCreateForm && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <div className="card-header">
                        <h3 className="card-title">Create New Release</h3>
                    </div>
                    <div className="card-body">
                        <form onSubmit={handleCreateRelease}>
                            <div className="form-group">
                                <label className="form-label">Release Name *</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={newRelease.name}
                                    onChange={(e) => setNewRelease({ ...newRelease, name: e.target.value })}
                                    placeholder="Enter release name"
                                    required
                                />
                            </div>
                            
                            <div className="form-group">
                                <label className="form-label">Release Description/Roadmap</label>
                                <textarea
                                    className="form-textarea"
                                    value={newRelease.description}
                                    onChange={(e) => setNewRelease({ ...newRelease, description: e.target.value })}
                                    placeholder="Enter release description or roadmap"
                                    rows="3"
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button 
                                    type="submit" 
                                    className="btn btn-primary"
                                    disabled={creating || !newRelease.name.trim()}
                                >
                                    {creating ? 'Creating...' : 'Create Release'}
                                </button>
                                <button 
                                    type="button" 
                                    className="btn btn-secondary"
                                    onClick={() => setShowCreateForm(false)}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Upload to Release Form */}
            {canManageReleases && releases.length > 0 && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <div className="card-header">
                        <h3 className="card-title">Upload to Release</h3>
                    </div>
                    <div className="card-body">
                        <form onSubmit={handleUpload}>
                            <div className="form-group">
                                <label className="form-label">Select Release *</label>
                                <select
                                    className="form-input"
                                    value={selectedRelease}
                                    onChange={(e) => setSelectedRelease(e.target.value)}
                                    required
                                >
                                    <option value="">Choose a release...</option>
                                    {releases.map((release) => (
                                        <option key={release.id} value={release.id} disabled={release.isLocked}>
                                            {release.name} {release.isLocked ? '(Locked)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Version</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={version}
                                    onChange={(e) => setVersion(e.target.value)}
                                    placeholder="e.g., 1.0.0, 1.1.0, 2.0.0"
                                />
                                <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '4px' }}>
                                    Leave empty for auto-increment
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Upload ZIP File *</label>
                                <input
                                    id="file-input"
                                    type="file"
                                    accept=".zip"
                                    onChange={handleFileSelect}
                                    className="form-input"
                                    required
                                />
                                <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '4px' }}>
                                    Only ZIP files are allowed. Maximum size: 50MB
                                </div>
                            </div>

                            {uploadFile && (
                                <div style={{ 
                                    padding: '12px', 
                                    background: '#e7f3ff', 
                                    borderRadius: '8px', 
                                    marginBottom: '16px',
                                    border: '1px solid #b3d9ff'
                                }}>
                                    <div style={{ fontWeight: '500', marginBottom: '4px' }}>Selected File:</div>
                                    <div style={{ fontSize: '14px', color: '#0066cc' }}>
                                        📁 {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                                    </div>
                                </div>
                            )}

                            {uploading && (
                                <div style={{ marginBottom: '16px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span>Uploading...</span>
                                        <span>{uploadProgress}%</span>
                                    </div>
                                    <div style={{ 
                                        width: '100%', 
                                        height: '8px', 
                                        background: '#e9ecef', 
                                        borderRadius: '4px',
                                        overflow: 'hidden'
                                    }}>
                                        <div style={{ 
                                            width: `${uploadProgress}%`, 
                                            height: '100%', 
                                            background: '#00B48B',
                                            transition: 'width 0.3s ease'
                                        }}></div>
                                    </div>
                                </div>
                            )}

                            {uploadStatus && (
                                <div style={{ 
                                    padding: '12px', 
                                    borderRadius: '8px', 
                                    marginBottom: '16px',
                                    background: uploadStatus.includes('✅') ? '#d4edda' : uploadStatus.includes('❌') ? '#f8d7da' : '#d1ecf1',
                                    color: uploadStatus.includes('✅') ? '#155724' : uploadStatus.includes('❌') ? '#721c24' : '#0c5460',
                                    border: `1px solid ${uploadStatus.includes('✅') ? '#c3e6cb' : uploadStatus.includes('❌') ? '#f5c6cb' : '#bee5eb'}`
                                }}>
                                    {uploadStatus}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button 
                                    type="submit" 
                                    className="btn btn-primary"
                                    disabled={uploading || !selectedRelease || !uploadFile}
                                >
                                    {uploading ? 'Uploading...' : 'Upload & Build'}
                                </button>
                                <button 
                                    type="button" 
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        setSelectedRelease('');
                                        setUploadFile(null);
                                        setVersion('');
                                        setUploadStatus('');
                                        setUploadProgress(0);
                                        document.getElementById('file-input').value = '';
                                    }}
                                    disabled={uploading}
                                >
                                    Clear
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Releases List */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">All Releases ({releases.length})</h3>
                </div>
                <div className="card-body">
                    {releases.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
                                </svg>
                            </div>
                            <h3>No Releases Found</h3>
                            <p>Create your first release to get started.</p>
                            {canManageReleases && (
                                <button 
                                    className="btn btn-primary"
                                    onClick={() => setShowCreateForm(true)}
                                >
                                    Create Release
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="releases-grid">
                            {releases.map((release) => (
                                <div key={release.id} className="release-card">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <h4 className="release-title">{release.name}</h4>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <span style={{ 
                                                padding: '4px 8px', 
                                                borderRadius: '4px', 
                                                fontSize: '12px',
                                                background: release.isLocked ? '#f8d7da' : '#d4edda',
                                                color: release.isLocked ? '#721c24' : '#155724'
                                            }}>
                                                {release.isLocked ? '🔒 Locked' : '🔓 Unlocked'}
                                            </span>
                                            {canManageReleases && (
                                                <button 
                                                    className={`btn btn-sm ${release.isLocked ? 'btn-warning' : 'btn-success'}`}
                                                    onClick={() => handleLockToggle(release.id, release.isLocked)}
                                                >
                                                    {release.isLocked ? 'Unlock' : 'Lock'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <p className="release-description">
                                        {release.description || 'No description provided'}
                                    </p>
                                    
                                    <div className="release-meta">
                                        <span>Created: {new Date(release.createdAt).toLocaleDateString()}</span>
                                        <span>By: {release.creator.name}</span>
                                    </div>

                                    <div style={{ 
                                        fontSize: '12px', 
                                        color: '#6c757d', 
                                        marginBottom: '16px',
                                        padding: '8px',
                                        background: '#f8f9fa',
                                        borderRadius: '6px'
                                    }}>
                                        <div>Release ID: {release.id}</div>
                                        <div>Versions: {release.versions.length}</div>
                                        {release.versions.length > 0 && (
                                            <div>Latest Version: {release.versions[0].version}</div>
                                        )}
                                    </div>

                                    {release.versions.length > 0 && (
                                        <div className="release-versions">
                                            <h5 style={{ fontSize: '14px', marginBottom: '8px', color: '#2c3e50' }}>Versions:</h5>
                                            {release.versions.map((version) => (
                                                <div key={version.id} style={{ 
                                                    padding: '8px', 
                                                    background: '#f8f9fa', 
                                                    borderRadius: '4px', 
                                                    marginBottom: '4px',
                                                    fontSize: '12px'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontWeight: '500' }}>v{version.version}</span>
                                                        <span style={{ color: '#6c757d' }}>
                                                            {new Date(version.createdAt).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                    {version.buildUrl && (
                                                        <a 
                                                            href={version.buildUrl} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            style={{ 
                                                                color: '#00B48B', 
                                                                textDecoration: 'none',
                                                                fontSize: '11px'
                                                            }}
                                                        >
                                                            🔗 Live Build
                                                        </a>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReleaseManagement;

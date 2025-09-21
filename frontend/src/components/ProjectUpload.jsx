import React, { useEffect, useState } from 'react';
import { fetchProjects, uploadProjectBuild } from '../api';
import { useAuth } from '../context/AuthContext';

const ProjectUpload = () => {
    const { user } = useAuth();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [selectedProject, setSelectedProject] = useState('');
    const [uploadFile, setUploadFile] = useState(null);
    const [version, setVersion] = useState('');
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadStatus, setUploadStatus] = useState('');

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        try {
            setLoading(true);
            const data = await fetchProjects();
            // Filter projects that user can upload to
            const uploadableProjects = data.filter(project => {
                if (user?.role === 'admin') return true;
                if (user?.role === 'manager' && project.assignedManagerId === user.id) return true;
                return false;
            });
            setProjects(uploadableProjects);
        } catch (err) {
            console.error('Error loading projects:', err);
        } finally {
            setLoading(false);
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
        if (!selectedProject || !uploadFile) return;

        try {
            setUploading(true);
            setUploadStatus('Uploading and building project...');
            setUploadProgress(0);

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

            const result = await uploadProjectBuild(selectedProject, uploadFile, version || null);

            clearInterval(progressInterval);
            setUploadProgress(100);

            setUploadStatus(`✅ Upload successful! Version: ${result.version.version} - Build URL: ${result.buildUrl}`);
            setUploadFile(null);
            setSelectedProject('');
            setVersion('');
            document.getElementById('file-input').value = '';
            await loadProjects(); // Refresh projects
        } catch (err) {
            setUploadStatus(`❌ Upload failed: ${err.error || err.message}`);
        } finally {
            setUploading(false);
        }
    };

    const canUpload = user?.role === 'admin' || user?.role === 'manager';

    if (loading) {
        return (
            <div className="loading">
                <div className="spinner"></div>
                Loading projects...
            </div>
        );
    }

    if (!canUpload) {
        return (
            <div className="card">
                <div className="card-body">
                    <div className="empty-state">
                        <div className="empty-state-icon">
                            <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,16.5L6.5,12L7.91,10.59L11,13.67L16.59,8.09L18,9.5L11,16.5Z"/>
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
                    Upload Project Build
                </h1>
                <p style={{ color: '#6c757d', fontSize: '16px' }}>
                    Upload a ZIP file containing your project build
                </p>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Upload Build</h3>
                </div>
                <div className="card-body">
                    <form onSubmit={handleUpload}>
                        <div className="form-group">
                            <label className="form-label">Select Project *</label>
                            <select
                                className="form-input"
                                value={selectedProject}
                                onChange={(e) => setSelectedProject(e.target.value)}
                                required
                            >
                                <option value="">Choose a project...</option>
                                {projects.map((project) => (
                                    <option key={project.id} value={project.id}>
                                        {project.name} {project.buildUrl ? '(has build)' : '(no build)'}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Version (Optional)</label>
                            <input
                                type="text"
                                className="form-input"
                                value={version}
                                onChange={(e) => setVersion(e.target.value)}
                                placeholder="e.g., 1.0.0, 1.1.0, 2.0.0"
                            />
                            <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '4px' }}>
                                Leave empty for auto-increment (e.g., 1.0.0 → 1.0.1)
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
                                disabled={uploading || !selectedProject || !uploadFile}
                            >
                                {uploading ? 'Uploading...' : 'Upload & Build'}
                            </button>
                            <button 
                                type="button" 
                                className="btn btn-secondary"
                                onClick={() => {
                                    setSelectedProject('');
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

            {/* Upload Instructions */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Upload Instructions</h3>
                </div>
                <div className="card-body">
                    <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
                        <h4 style={{ marginBottom: '12px', color: '#2c3e50' }}>How to prepare your project:</h4>
                        <ol style={{ paddingLeft: '20px', marginBottom: '16px' }}>
                            <li style={{ marginBottom: '8px' }}>Create a ZIP file containing your project files</li>
                            <li style={{ marginBottom: '8px' }}>Ensure your project has a <code>package.json</code> file</li>
                            <li style={{ marginBottom: '8px' }}>Make sure your build script is configured (e.g., <code>npm run build</code>)</li>
                            <li style={{ marginBottom: '8px' }}>The system will automatically run <code>npm install</code> and <code>npm run build</code></li>
                            <li>Your project will be accessible via a live URL once uploaded</li>
                        </ol>
                        
                        <div style={{ 
                            padding: '12px', 
                            background: '#fff3cd', 
                            borderRadius: '8px',
                            border: '1px solid #ffeaa7'
                        }}>
                            <strong>Note:</strong> The build process may take a few minutes depending on your project size and dependencies.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectUpload;

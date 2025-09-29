import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProjects, createProject } from '../api';
import { useAuth } from '../context/AuthContext';
import DiffModal from './DiffModal';
import ProjectActionsDropdown from './ProjectActionsDropdown';
import ReleaseManagement from './ReleaseManagement';

const ProjectManagement = ({ setActiveTab }) => {
    const { user } = useAuth();
    const navigate = useNavigate();
    console.log('ProjectManagement user:', user);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [creating, setCreating] = useState(false);

    const [newProject, setNewProject] = useState({
        name: '',
        description: '',
        assignedManagerId: user.role === 'manager' ? user.id : null
    });
    const [diffModal, setDiffModal] = useState({ isOpen: false, projectId: null, projectName: '' });
    const [selectedProject, setSelectedProject] = useState(null);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        try {
            setLoading(true);
            const data = await fetchProjects();
            console.log('ProjectManagement projects data:', data);
            setProjects(data);
        } catch (err) {
            setError(err.message || 'Failed to load projects');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateProject = async (e) => {
        e.preventDefault();
        if (!newProject.name.trim()) return;

        try {
            setCreating(true);
            await createProject(newProject);
            setNewProject({ name: '', description: '', assignedManagerId: user.role === 'manager' ? user.id : null });
            setShowCreateForm(false);
            await loadProjects();
        } catch (err) {
            setError(err.message || 'Failed to create project');
        } finally {
            setCreating(false);
        }
    };

    const canCreateProject = user?.role === 'admin' || user?.role === 'manager';

    if (loading) {
        return (
            <div className="loading">
                <div className="spinner"></div>
                Loading projects...
            </div>
        );
    }

    // If a project is selected, show release management
    if (selectedProject) {
        return (
            <div>
                <div style={{ marginBottom: '16px' }}>
                    <button 
                        className="btn btn-secondary"
                        onClick={() => setSelectedProject(null)}
                        style={{ marginBottom: '16px' }}
                    >
                        ← Back to Projects
                    </button>
                </div>
                <ReleaseManagement 
                    projectId={selectedProject.id} 
                    projectName={selectedProject.name}
                />
            </div>
        );
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: '600', color: '#2c3e50', marginBottom: '8px' }}>
                        Project Management
                    </h1>
                    <p style={{ color: '#6c757d', fontSize: '16px' }}>
                        Manage and organize your projects
                    </p>
                </div>
                {canCreateProject && (
                    <button 
                        className="btn btn-primary"
                        onClick={() => setShowCreateForm(true)}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                        </svg>
                        Create Project
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

            {/* Create Project Form */}
            {showCreateForm && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <div className="card-header">
                        <h3 className="card-title">Create New Project</h3>
                    </div>
                    <div className="card-body">
                        <form onSubmit={handleCreateProject}>
                            <div className="form-group">
                                <label className="form-label">Project Name *</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={newProject.name}
                                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                                    placeholder="Enter project name"
                                    required
                                />
                            </div>
                            
                            <div className="form-group">
                                <label className="form-label">Description</label>
                                <textarea
                                    className="form-textarea"
                                    value={newProject.description}
                                    onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                                    placeholder="Enter project description"
                                    rows="3"
                                />
                            </div>

                            {user?.role === 'admin' && (
                                <div className="form-group">
                                    <label className="form-label">Assign Manager</label>
                                    <input
                                        type="number"
                                        className="form-input"
                                        value={newProject.assignedManagerId}
                                        onChange={(e) => setNewProject({ ...newProject, assignedManagerId: parseInt(e.target.value) })}
                                        placeholder="Manager ID (optional)"
                                    />
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button 
                                    type="submit" 
                                    className="btn btn-primary"
                                    disabled={creating || !newProject.name.trim()}
                                >
                                    {creating ? 'Creating...' : 'Create Project'}
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

            {/* Projects List */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">All Projects ({projects.length})</h3>
                </div>
                <div className="card-body">
                    {projects.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
                                </svg>
                            </div>
                            <h3>No Projects Found</h3>
                            <p>Create your first project to get started.</p>
                            {canCreateProject && (
                                <button 
                                    className="btn btn-primary"
                                    onClick={() => setShowCreateForm(true)}
                                >
                                    Create Project
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="projects-grid">
                            {projects.map((project) => (
                                <div key={project.id} className="project-card">
                                    <h4 className="project-title">{project.name}</h4>
                                    <p className="project-description">
                                        {project.description || 'No description provided'}
                                    </p>
                                    
                                    <div className="project-meta">
                                        <span>Created: {new Date(project.createdAt).toLocaleDateString()}</span>
                                        <span style={{ 
                                            color: (project.versions && project.versions.length > 0 && project.versions[0].buildUrl) ? '#00B48B' : '#6c757d',
                                            fontWeight: '500'
                                        }}>
                                            {(project.versions && project.versions.length > 0 && project.versions[0].buildUrl) ? 'Live' : 'Draft'}
                                        </span>
                                    </div>

                                    <div style={{ 
                                        fontSize: '12px', 
                                        color: '#6c757d', 
                                        marginBottom: '16px',
                                        padding: '8px',
                                        background: '#f8f9fa',
                                        borderRadius: '6px'
                                    }}>
                                        <div>ID: {project.id}</div>
                                        <div>Manager ID: {project.assignedManagerId}</div>
                                        <div>Releases: {project.releases?.length || 0}</div>
                                        {project.versions && project.versions.length > 0 && (
                                            <div>Current Version: {project.versions[0].version}</div>
                                        )}
                                    </div>

                                    {/* Show recent releases */}
                                    {project.releases && project.releases.length > 0 && (
                                        <div style={{ 
                                            fontSize: '12px', 
                                            color: '#6c757d', 
                                            marginBottom: '16px',
                                            padding: '8px',
                                            background: '#e7f3ff',
                                            borderRadius: '6px',
                                            border: '1px solid #b3d9ff'
                                        }}>
                                            <div style={{ fontWeight: '500', marginBottom: '4px' }}>Recent Releases:</div>
                                            {project.releases.slice(0, 2).map((release) => (
                                                <div key={release.id} style={{ marginBottom: '2px' }}>
                                                    {release.name} {release.isLocked ? '🔒' : '🔓'}
                                                </div>
                                            ))}
                                            {project.releases.length > 2 && (
                                                <div style={{ fontStyle: 'italic' }}>
                                                    +{project.releases.length - 2} more...
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="project-actions">
                                        {project.versions && project.versions.length > 0 && project.versions[0].buildUrl && (
                                            <a 
                                                href={project.versions[0].buildUrl} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="btn btn-primary"
                                            >
                                                Live
                                            </a>
                                        )}
                                        
                                        <button 
                                            className="btn btn-outline"
                                            onClick={() => setSelectedProject(project)}
                                        >
                                            Manage Releases
                                        </button>
                                        
                                        <ProjectActionsDropdown
                                            project={project}
                                            user={user}
                                            onGitDiff={() => setDiffModal({ isOpen: true, projectId: project.id, projectName: project.name })}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            
            {/* Diff Modal */}
            <DiffModal
                isOpen={diffModal.isOpen}
                onClose={() => setDiffModal({ isOpen: false, projectId: null, projectName: '' })}
                projectId={diffModal.projectId}
                projectName={diffModal.projectName}
            />
        </div>
    );
};

export default ProjectManagement;

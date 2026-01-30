import React, { useEffect, useState } from 'react';
import { fetchProjects } from '../api';
import { useAuth } from '../context/AuthContext';
import DiffModal from '../components/DiffModal';
import ProjectActionsDropdown from '../components/ProjectActionsDropdown';

const ProjectView = ({ setActiveTab, setSelectedProjectForVersions }) => {
    const { user } = useAuth();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, live, draft
    const [searchTerm, setSearchTerm] = useState('');
    const [diffModal, setDiffModal] = useState({ isOpen: false, projectId: null, projectName: '' });
    // const [selectedProjectForVersions, setSelectedProjectForVersions] = useState(null);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        try {
            setLoading(true);
            const data = await fetchProjects();
            setProjects(data);
        } catch (err) {
            console.error('Error loading projects:', err);
        } finally {
            setLoading(false);
        }
    };

    const filteredProjects = projects.filter(project => {
        const matchesSearch = project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (project.description && project.description.toLowerCase().includes(searchTerm.toLowerCase()));

        const hasActiveVersion = project.versions && project.versions.length > 0 && project.versions[0].buildUrl;

        if (filter === 'live') return matchesSearch && hasActiveVersion;
        if (filter === 'draft') return matchesSearch && !hasActiveVersion;
        return matchesSearch;
    });

    const getProjectStatus = (project) => {
        const hasActiveVersion = project.versions && project.versions.length > 0 && project.versions[0].buildUrl;
        if (hasActiveVersion) {
            return { text: 'Live', color: '#00B48B', bg: '#d4edda' };
        }
        return { text: 'Draft', color: '#6c757d', bg: '#e9ecef' };
    };

    if (loading) {
        return (
            <div className="loading">
                <div className="spinner"></div>
                Loading projects...
            </div>
        );
    }

    return (
        <div>
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '28px', fontWeight: '600', color: '#2c3e50', marginBottom: '8px' }}>
                    View Projects
                </h1>
                <p style={{ color: '#6c757d', fontSize: '16px' }}>
                    Browse and access all your projects
                </p>
            </div>

            {/* Filters and Search */}
            <div className="card" style={{ marginBottom: '24px' }}>
                <div className="card-body">
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1', minWidth: '200px' }}>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Search projects..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                                onClick={() => setFilter('all')}
                            >
                                All ({projects.length})
                            </button>
                            <button
                                className={`btn ${filter === 'live' ? 'btn-primary' : 'btn-outline'}`}
                                onClick={() => setFilter('live')}
                            >
                                Live ({projects.filter(p => p.versions && p.versions.length > 0 && p.versions[0].buildUrl).length})
                            </button>
                            <button
                                className={`btn ${filter === 'draft' ? 'btn-primary' : 'btn-outline'}`}
                                onClick={() => setFilter('draft')}
                            >
                                Draft ({projects.filter(p => !p.versions || p.versions.length === 0 || !p.versions[0].buildUrl).length})
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Projects Grid */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">
                        {filter === 'all' ? 'All Projects' :
                            filter === 'live' ? 'Live Projects' : 'Draft Projects'}
                        ({filteredProjects.length})
                    </h3>
                </div>
                <div className="card-body">
                    {filteredProjects.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M15.5,14H20.5L22,15.5V18.5L20.5,20H15.5L14,18.5V15.5L15.5,14M21,16.5V17.5L20,18.5H16V17.5L17,16.5V15.5L16,14.5H20L21,15.5V16.5M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4Z" />
                                </svg>
                            </div>
                            <h3>No Projects Found</h3>
                            <p>
                                {searchTerm ?
                                    `No projects match "${searchTerm}"` :
                                    `No ${filter === 'all' ? '' : filter} projects available`
                                }
                            </p>
                        </div>
                    ) : (
                        <div className="projects-grid">
                            {filteredProjects.map((project) => {
                                const status = getProjectStatus(project);
                                return (
                                    <div key={project.id} className="project-card">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                            <h4 className="project-title" style={{ margin: 0, flex: 1 }}>
                                                {project.name}
                                            </h4>
                                            <span style={{
                                                padding: '4px 8px',
                                                borderRadius: '12px',
                                                fontSize: '12px',
                                                fontWeight: '500',
                                                color: status.color,
                                                backgroundColor: status.bg
                                            }}>
                                                {status.text}
                                            </span>
                                        </div>

                                        <p className="project-description">
                                            {project.description || 'No description provided'}
                                        </p>

                                        <div className="project-meta">
                                            <span>Created: {new Date(project.createdAt).toLocaleDateString()}</span>
                                            <span>ID: {project.id}</span>
                                        </div>

                                        {project.versions && project.versions.length > 0 && (
                                            <div style={{
                                                marginBottom: '16px',
                                                padding: '8px',
                                                background: '#f8f9fa',
                                                borderRadius: '6px',
                                                border: '1px solid #e9ecef'
                                            }}>
                                                <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>
                                                    Current Version: {project.versions[0].version}
                                                </div>
                                                <div style={{ fontSize: '12px', color: '#6c757d' }}>
                                                    Last Updated: {new Date(project.versions[0].createdAt).toLocaleDateString()}
                                                </div>
                                            </div>
                                        )}

                                        {project.versions && project.versions.length > 0 && project.versions[0].buildUrl && (
                                            <div style={{
                                                marginBottom: '16px',
                                                padding: '8px',
                                                background: '#e7f3ff',
                                                borderRadius: '6px',
                                                border: '1px solid #b3d9ff'
                                            }}>
                                                <div style={{ fontSize: '12px', color: '#0066cc', marginBottom: '4px' }}>
                                                    Live URL:
                                                </div>
                                                <div style={{
                                                    fontSize: '12px',
                                                    color: '#0066cc',
                                                    wordBreak: 'break-all',
                                                    fontFamily: 'monospace'
                                                }}>
                                                    {project.versions[0].buildUrl}
                                                </div>
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
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                                        <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                                                    </svg>
                                                    Open Live
                                                </a>
                                            )}

                                            {(!project.versions || project.versions.length === 0) && (user?.role === 'admin' || user?.role === 'manager') && (
                                                <button
                                                    className="btn btn-outline"
                                                    onClick={() => setActiveTab('upload')}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                                        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                                                    </svg>
                                                    Upload
                                                </button>
                                            )}

                                            <ProjectActionsDropdown
                                                project={project}
                                                user={user}
                                                onGitDiff={() => setDiffModal({ isOpen: true, projectId: project.id, projectName: project.name })}
                                                onManage={() => {
                                                    setSelectedProjectForVersions(project);
                                                    setActiveTab('versions');
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Quick Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginTop: '24px' }}>
                <div className="card">
                    <div className="card-body" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: '#00B48B', marginBottom: '8px' }}>
                            {projects.filter(p => p.versions && p.versions.length > 0 && p.versions[0].buildUrl).length}
                        </div>
                        <div style={{ color: '#6c757d', fontSize: '14px' }}>Live Projects</div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-body" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: '#6c757d', marginBottom: '8px' }}>
                            {projects.filter(p => !p.versions || p.versions.length === 0 || !p.versions[0].buildUrl).length}
                        </div>
                        <div style={{ color: '#6c757d', fontSize: '14px' }}>Draft Projects</div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-body" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: '#007bff', marginBottom: '8px' }}>
                            {projects.length}
                        </div>
                        <div style={{ color: '#6c757d', fontSize: '14px' }}>Total Projects</div>
                    </div>
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

export default ProjectView;
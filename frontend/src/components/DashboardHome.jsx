import React, { useEffect, useState } from 'react';
import { fetchProjects } from '../api';
import DiffModal from './DiffModal';
import ProjectActionsDropdown from './ProjectActionsDropdown';

const DashboardHome = ({ setActiveTab }) => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalProjects: 0,
        activeProjects: 0,
        recentUploads: 0
    });
    const [diffModal, setDiffModal] = useState({ isOpen: false, projectId: null, projectName: '' });

    useEffect(() => {
        const loadDashboardData = async () => {
            try {
                const projectsData = await fetchProjects();
                console.log('Dashboard projects data:', projectsData);
                setProjects(projectsData);
                
                // Calculate stats
                const totalProjects = projectsData.length;
                const activeProjects = projectsData.filter(p => 
                    p.versions && p.versions.length > 0 && p.versions[0].buildUrl
                ).length;
                const recentUploads = projectsData.filter(p => {
                    if (p.versions && p.versions.length > 0) {
                        const lastVersion = p.versions[0];
                        const createdAt = new Date(lastVersion.createdAt);
                        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                        return createdAt > weekAgo;
                    }
                    return false;
                }).length;

                setStats({
                    totalProjects,
                    activeProjects,
                    recentUploads
                });
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            } finally {
                setLoading(false);
            }
        };

        loadDashboardData();
    }, []);

    if (loading) {
        return (
            <div className="loading">
                <div className="spinner"></div>
                Loading dashboard...
            </div>
        );
    }

    return (
        <div>
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '28px', fontWeight: '600', color: '#2c3e50', marginBottom: '8px' }}>
                    Welcome to Zip Sync Dashboard
                </h1>
                <p style={{ color: '#6c757d', fontSize: '16px' }}>
                    Manage your projects, upload builds, and track progress all in one place.
                </p>
            </div>

            {/* Stats Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <div className="card">
                    <div className="card-body" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '32px', fontWeight: '700', color: '#00B48B', marginBottom: '8px' }}>
                            {stats.totalProjects}
                        </div>
                        <div style={{ color: '#6c757d', fontSize: '14px' }}>Total Projects</div>
                    </div>
                </div>
                
                <div className="card">
                    <div className="card-body" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '32px', fontWeight: '700', color: '#007bff', marginBottom: '8px' }}>
                            {stats.activeProjects}
                        </div>
                        <div style={{ color: '#6c757d', fontSize: '14px' }}>Active Builds</div>
                    </div>
                </div>
                
                <div className="card">
                    <div className="card-body" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '32px', fontWeight: '700', color: '#ffc107', marginBottom: '8px' }}>
                            {stats.recentUploads}
                        </div>
                        <div style={{ color: '#6c757d', fontSize: '14px' }}>Recent Uploads</div>
                    </div>
                </div>
            </div>

            {/* Recent Projects */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Recent Projects</h3>
                </div>
                <div className="card-body">
                    {projects.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
                                </svg>
                            </div>
                            <h3>No Projects Yet</h3>
                            <p>Get started by creating your first project or uploading a build.</p>
                        </div>
                    ) : (
                        <div className="projects-grid">
                            {projects.slice(-6).reverse().map((project) => (
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
                                    <div className="project-actions">
                                        {project.versions && project.versions.length > 0 && project.versions[0].buildUrl && (
                                            <a 
                                                href={project.versions[0].buildUrl} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="btn btn-primary"
                                            >
                                                View Live
                                            </a>
                                        )}
                                        
                                        <button 
                                            className="btn btn-outline"
                                            onClick={() => setActiveTab('projects')}
                                        >
                                            Manage
                                        </button>
                                        
                                        <ProjectActionsDropdown
                                            project={project}
                                            user={{ role: 'admin' }}
                                            onGitDiff={() => setDiffModal({ isOpen: true, projectId: project.id, projectName: project.name })}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Quick Actions */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Quick Actions</h3>
                </div>
                <div className="card-body">
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        <button 
                            className="btn btn-primary"
                            onClick={() => setActiveTab('projects')}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                            </svg>
                            Create New Project
                        </button>
                        <button 
                            className="btn btn-outline"
                            onClick={() => setActiveTab('upload')}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
                            </svg>
                            Upload Build
                        </button>
                        <button 
                            className="btn btn-outline"
                            onClick={() => setActiveTab('view')}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                <path d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z"/>
                            </svg>
                            View All Projects
                        </button>
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

export default DashboardHome;

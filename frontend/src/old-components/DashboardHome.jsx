import React, { useEffect, useState } from 'react';
import { fetchProjects } from '../api';
import DiffModal from './DiffModal';
import ProjectActionsDropdown from './ProjectActionsDropdown';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

const DashboardHome = () => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
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
            <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
                Loading dashboard...
            </div>
        );
    }

    console.log(stats)

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-8 flex w-full justify-between">
                <div>
                    <h1 className="text-xl font-bold text-slate-800 tracking-tight">
                        Welcome to Zip Sync Dashboard
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Manage your projects, upload builds, and track progress all in one place.
                    </p>
                </div>
                <Button
                    className="bg-emerald-500 hover:bg-emerald-600 text-white gap-2"
                    onClick={() => navigate('/projects')}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                    </svg>
                    Create New Project
                </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Total Projects
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-emerald-500">{stats.totalProjects}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Active Builds
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-blue-500">{stats.activeProjects}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Recent Uploads
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-amber-500">{stats.recentUploads}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Recent Projects */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-8 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="text-lg font-semibold text-slate-800">Recent Projects</h3>
                </div>
                <div className="p-6">
                    {projects.length === 0 ? (
                        <div className="text-center py-16 text-slate-500 flex flex-col items-center">
                            <div className="mb-4 opacity-50 text-slate-400">
                                <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-medium text-slate-700 mb-2">No Projects Yet</h3>
                            <p>Get started by creating your first project or uploading a build.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {projects.slice(-6).reverse().map((project) => (
                                <div key={project.id} className="group flex flex-col bg-white rounded-xl border border-slate-200 p-5 hover:border-emerald-500 transition-all shadow-sm hover:shadow-md relative">
                                    <div className="flex-1">
                                        <h4 className="font-semibold text-slate-800 text-lg mb-2 truncate" title={project.name}>{project.name}</h4>
                                        <p className="text-slate-500 text-sm mb-4 line-clamp-2 min-h-[40px]">
                                            {project.description || 'No description provided'}
                                        </p>
                                        <div className="flex items-center justify-between text-xs text-slate-400 mb-4 border-t border-slate-100 pt-3">
                                            <span>Created: {new Date(project.createdAt).toLocaleDateString()}</span>
                                            <span className={`font-medium px-2 py-0.5 rounded-full text-xs ${(project.versions && project.versions.length > 0 && project.versions[0].buildUrl) ? 'text-emerald-700 bg-emerald-50' : 'text-slate-600 bg-slate-100'}`}>
                                                {(project.versions && project.versions.length > 0 && project.versions[0].buildUrl) ? 'Live' : 'Draft'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-auto">
                                        {project.versions && project.versions.length > 0 && project.versions[0].buildUrl && (
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                                                asChild
                                            >
                                                <a
                                                    href={project.versions[0].buildUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    Live
                                                </a>
                                            </Button>
                                        )}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => navigate(`/projects/${project.id}`, { state: { projectName: project.name } })}
                                        >
                                            Manage
                                        </Button>

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

import React, { useEffect, useState } from 'react';
import { fetchProjects } from '../api';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import ProjectCard from '../components/ProjectCard';
import { CreateProjectButton } from '../components/CreateProjectButton';
import { PageHeader } from '@/components/PageHeader';

const Dashboard = () => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalProjects: 0,
        activeProjects: 0,
        recentUploads: 0
    });

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

    return (
        <div className="mx-auto">

            <PageHeader title="Welcome to LaunchPad Dashboard" description="Manage your projects, upload builds, and track progress all in one place.">
                <CreateProjectButton />
            </PageHeader>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6 mb-8">
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
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4  gap-6">
                            {projects.slice(-6).reverse().map((project) => (
                                <ProjectCard key={project.id} project={project} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
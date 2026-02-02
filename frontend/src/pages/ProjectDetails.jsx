import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import ReleaseManagement from '../components/ReleaseManagement';
import { RoadMapManagement } from '../components/RoadMapManagement';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { ArrowLeft, GitCommit, FileDiff } from 'lucide-react';
import DiffModal from '../components/DiffModal';
import { fetchProjectById } from '@/api';

const ProjectDetails = () => {
    const { projectId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();

    // State
    const [project, setProject] = useState(location.state?.project || null);
    const [loading, setLoading] = useState(!location.state?.project);
    // const [loading, setLoading] = useState(false);
    const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('releases');


    // Fetch project details if not passed in state or to get fresh data
    useEffect(() => {
        const loadProject = async () => {
            try {
                if (!project) setLoading(true); // Only show loading if we don't have project data yet
                const data = await fetchProjectById(projectId);
                console.log("Selected Project Data", data);
                setProject(data);
            } catch (error) {
                console.error("Failed to load project:", error);
            } finally {
                setLoading(false);
            }
        };

        loadProject();
    }, [projectId]);

    const projectName = project?.name || 'Project';
    const projectDescription = project?.description || 'This is Testing Project';
    const projectStatus = project?.status || 'Active';

    // Status badge color logic (reused from ProjectCard for consistency)
    const getStatusColor = (status) => {
        switch (status?.toLowerCase()) {
            case 'active': return 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200';
            case 'archived': return 'bg-slate-100 text-slate-700 hover:bg-slate-200';
            case 'development': return 'bg-blue-100 text-blue-700 hover:bg-blue-200';
            default: return 'bg-slate-100 text-slate-700 hover:bg-slate-200';
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
                Loading project details...
            </div>
        );
    }

    console.log("Project Detail is rendered")
    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-4">
                <div className="mb-2">
                    <Button
                        variant="ghost"
                        onClick={() => navigate('/projects')}
                        className="gap-2 pl-0 hover:bg-transparent hover:text-primary text-slate-500"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Projects
                    </Button>
                </div>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-3">
                            <h1 className="text-3xl font-bold text-slate-900">{projectName}</h1>
                            <Badge className={getStatusColor(projectStatus)} variant="secondary">
                                {projectStatus}
                            </Badge>
                        </div>
                        {projectDescription && (
                            <p className="text-slate-500 max-w-2xl">{projectDescription}</p>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            className="gap-2"
                            onClick={() => setIsDiffModalOpen(true)}
                        >
                            <GitCommit className="w-4 h-4" />
                            View Diff
                        </Button>
                        <Button
                            variant="default" // Changed to default for emphasis or keep outline? Plan said "View Changes" button
                            className="gap-2 text-white"
                            onClick={() => navigate(`/projects/${projectId}/diff`)}
                        >
                            <FileDiff className="w-4 h-4" />
                            View Changes
                        </Button>
                    </div>
                </div>
            </div>

            {/* Tabs Section */}
            <Tabs defaultValue="releases" value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-slate-100 p-1 rounded-lg w-full md:w-auto h-auto grid grid-cols-2 md:inline-flex md:gap-1">
                    <TabsTrigger
                        value="releases"
                        className="data-[state=active]:bg-white data-[state=active]:text-emerald-600 data-[state=active]:shadow-sm transition-all"
                    >
                        Releases
                    </TabsTrigger>
                    <TabsTrigger
                        value="roadmap"
                        className="data-[state=active]:bg-white data-[state=active]:text-emerald-600 data-[state=active]:shadow-sm transition-all"
                    >
                        Roadmap
                    </TabsTrigger>
                </TabsList>

                <div className="mt-6">
                    <TabsContent value="releases" className="m-0 focus-visible:outline-none">
                        <ReleaseManagement
                            projectId={projectId}
                            projectName={projectName}
                        />
                    </TabsContent>

                    <TabsContent value="roadmap" className="m-0 focus-visible:outline-none">
                        <RoadMapManagement />
                    </TabsContent>
                </div>
            </Tabs>

            {/* Diff Modal */}
            <DiffModal
                isOpen={isDiffModalOpen}
                onClose={() => setIsDiffModalOpen(false)}
                projectId={projectId}
                projectName={projectName}
            />
        </div>
    );
};

export default ProjectDetails;

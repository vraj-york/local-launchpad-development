import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { ArrowLeft, GitCommit, FileDiff } from 'lucide-react';
import DiffModal from '../components/DiffModal';
import { fetchProjectById, updateProject } from '@/api';
import RoadMapManagement from '@/components/RoadMapManagement';
import ReleaseManagement from '@/components/ReleaseManagement';
import { PageHeader } from '@/components/PageHeader';
import { toast } from 'sonner';

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


    // Helper to refresh project data
    const refreshProject = async () => {
        try {
            const data = await fetchProjectById(projectId);
            setProject(data);
        } catch (error) {
            console.error("Failed to refresh project:", error);
        }
    };

    // Fetch project details if not passed in state or to get fresh data
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

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col gap-0">
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

                <PageHeader title={projectName} description={projectDescription} >
                    <div className='flex gap-2'>
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
                        </Button></div>
                </PageHeader>


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
                        <RoadMapManagement
                            value={project?.roadmaps || []}
                            onChange={(newRoadmaps) => setProject(prev => ({ ...prev, roadmaps: newRoadmaps }))}
                            isEmbedded={true}
                            onRoadmapUpdate={async (roadmap) => {
                                // We use updateProject endpoint which expects { roadmap: ... }
                                try {
                                    console.log(roadmap, "road map payload")
                                    const updatedProject = await updateProject(project.id, { roadmap });
                                    toast.success("Roadmap updated successfully");
                                } catch (error) {
                                    toast.error(error.error || "Failed to update roadmap");
                                }

                                refreshProject();
                                return null; // Signal to RoadMapManagement that we handled it but no direct object return to sync immediately via return (refresh does it).
                            }}
                        />
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

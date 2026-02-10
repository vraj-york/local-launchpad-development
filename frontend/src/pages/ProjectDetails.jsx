import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { ArrowLeft, GitCommit, FileDiff } from 'lucide-react';
import DiffModal from '../components/DiffModal';
import { fetchProjectById, updateProject, deleteRoadmap, deleteRoadmapItem, updateRoadmapByProjectId, getRoadmapItemsByProjectId } from '@/api';
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
    const [roadmap, setRoadmap] = useState(null);
    // const [loading, setLoading] = useState(false);
    const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('releases');


    // Helper to refresh project data
    const refreshProject = async () => {
        try {
            const data = await getRoadmapItemsByProjectId(projectId);
            setRoadmap(data);
        } catch (error) {
            console.error("Failed to refresh project:", error);
        }
    };

    // Fetch project details if not passed in state or to get fresh data
    useEffect(() => {
        const loadProject = async () => {
            try {
                if (!project) setLoading(true); // Only show loading if we don't have project data yet
                const data = await fetchProjectById(projectId);
                setProject(data);
            } catch (error) {
                console.error("Failed to load project:", error);
            } finally {
                setLoading(false);
            }
        };

        loadProject();
    }, [projectId]);

    useEffect(() => {
        const loadRoadmap = async () => {
            try {
                if (!project) setLoading(true); // Only show loading if we don't have project data yet
                const data = await getRoadmapItemsByProjectId(projectId);
                setRoadmap(data);
                console.log(data, "data from roadmap from getRoadmapItemsByProjectId")
            } catch (error) {
                console.error("Failed to load project:", error);
            } finally {
                setLoading(false);
            }
        };

        loadRoadmap();
    }, [projectId]);

    const projectName = project?.name || 'Project';
    const projectDescription = project?.description || 'This is Testing Project';

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
                        className="hover:bg-transparent hover:text-primary text-slate-500"
                        style={{ padding: "0px" }}
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
                            // value={project?.roadmaps || []}
                            value={roadmap}
                            onChange={(newRoadmaps) => setRoadmap(newRoadmaps)}
                            isEmbedded={true}
                            onRoadmapUpdate={async (roadmap) => {
                                // We use updateProject endpoint which expects { roadmap: ... }
                                try {
                                    // console.log(roadmap, "road map payload")
                                    const data = {
                                        roadmap: roadmap
                                    }
                                    console.log(data, "road map payload to update")
                                    const updatedProject = await updateRoadmapByProjectId(project.id, data);
                                    toast.success("Roadmap updated successfully");
                                } catch (error) {
                                    toast.error(error.error || "Failed to update roadmap");
                                }

                                refreshProject();
                                return null;
                            }}
                            onRoadmapDelete={async (roadmapId) => {
                                try {
                                    await deleteRoadmap(roadmapId);
                                    // Update local state immediately to remove from UI
                                    // setRoadmap(roadmap.filter(r => r.id !== roadmapId));
                                    toast.success("Roadmap deleted successfully");
                                    refreshProject();
                                } catch (error) {
                                    console.error("Failed to delete roadmap:", error);
                                    toast.error(error.error || "Failed to delete roadmap");
                                }
                            }}
                            onItemDelete={async (roadmapId, itemId) => {
                                try {
                                    await deleteRoadmapItem(roadmapId, itemId);
                                    toast.success("Roadmap item deleted");
                                    refreshProject();
                                } catch (error) {
                                    console.error("Failed to delete item:", error);
                                    if (error.status !== 404) {
                                        toast.error(error.error || "Failed to delete item");
                                    }
                                }
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

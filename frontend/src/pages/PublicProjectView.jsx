import { fetchProjectById } from '@/api';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import React, { useEffect, useState } from 'react'
import RoadMapManagement from '@/components/RoadMapManagement';
import { ExternalLink } from 'lucide-react';

export const PublicProjectView = () => {
    const [publicProject, setPublicProject] = useState(null);
    const [loading, setLoading] = useState(true);

    const projectId = 12;

    useEffect(() => {
        const loadProject = async () => {
            try {
                setLoading(true);
                const data = await fetchProjectById(projectId);
                setPublicProject(data);
                console.log("Public Project data loaded:", data);
            } catch (error) {
                console.error("Failed to load project:", error);
            } finally {
                setLoading(false);
            }
        };

        loadProject();
    }, [projectId]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
                Loading project roadmap...
            </div>
        );
    }

    console.log("Public project data:", publicProject);

    return (
        <div className="flex-1 flex flex-col min-h-screen bg-slate-50 w-full overflow-hidden">
            <div className="mx-auto w-full px-4 md:px-8 py-6">


                <div className="w-full flex justify-between items-center bg-white p-5 rounded-lg">
                    <div className='flex flex-col item-center'>
                        <h1 className="text-xl font-bold text-slate-800 tracking-tight">
                            Name: {publicProject?.name}
                        </h1>
                        <p className="text-muted-foreground text-sm">
                            Description: {publicProject?.description}
                        </p>
                        <p className="text-muted-foreground text-sm">
                            Manager: {publicProject?.assignedManager?.name}
                        </p>
                    </div>
                    <div>
                        <Button
                            variant="default"
                            className="gap-2 text-white"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            View Live Project
                        </Button>
                    </div>
                </div>

                <div className="mt-8">
                    <RoadMapManagement
                        value={publicProject?.roadmaps || []}
                        readOnly={true}
                        isEmbedded={true}
                    />
                </div>
            </div>
        </div>
    )
}

import React from 'react';
import { FolderOpen } from 'lucide-react';
import { Badge } from './ui/badge';
import ProjectCard from './ProjectCard';

const ProjectList = ({ projects }) => {

    if (!projects || projects.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="bg-slate-100 p-4 rounded-full mb-4 text-slate-400">
                    <FolderOpen className="w-12 h-12" />
                </div>
                <h3 className="text-lg font-semibold text-slate-700 mb-2">No Projects Found</h3>
                <p className="text-slate-500">Create your first project to get started!</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
                <Badge variant="secondary" className="bg-slate-100">
                    {projects.length} project{projects.length !== 1 ? 's' : ''}
                </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map(project => (
                    <ProjectCard key={project.id} project={project} />
                ))}
            </div>
        </div>
    );
};

export default ProjectList;
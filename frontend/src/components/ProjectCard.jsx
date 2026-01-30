import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Calendar, Hash, User, Clock, ExternalLink, Copy, Check } from 'lucide-react';
import { Separator } from './ui/separator';
import ProjectActionsDropdown from './ProjectActionsDropdown';
import DiffModal from './DiffModal';

const ProjectCard = ({ project }) => {
    const navigate = useNavigate();
    const [copied, setCopied] = useState(false);
    const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

    // Safe access to project properties with fallbacks
    const latestVersion = project.versions && project.versions.length > 0 ? project.versions[0] : null;
    const versionNumber = latestVersion ? latestVersion.versionNumber || 'v1.0.0' : 'No versions';
    const buildUrl = latestVersion ? latestVersion.buildUrl : null;
    const managerName = project.manager?.name || project.manager || 'Unknown Manager';
    const status = project.status || 'Active'; // Default to active if no status provided

    // Status badge color logic
    const getStatusColor = (status) => {
        switch (status.toLowerCase()) {
            case 'active': return 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200';
            case 'archived': return 'bg-slate-100 text-slate-700 hover:bg-slate-200';
            case 'development': return 'bg-blue-100 text-blue-700 hover:bg-blue-200';
            default: return 'bg-slate-100 text-slate-700 hover:bg-slate-200';
        }
    };

    const handleCopyLink = (e) => {
        e.stopPropagation();
        if (buildUrl) {
            navigator.clipboard.writeText(buildUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <>
            <Card className="hover:shadow-md transition-shadow hover:border-emerald-200 flex flex-col h-full gap-6">
                <CardHeader className="">
                    <div className="flex justify-between items-start gap-2">
                        <CardTitle className="text-lg leading-tight ">
                            <Link
                                to={`/projects/${project.id}`}
                                className="text-emerald-600 hover:text-emerald-700 hover:underline font-semibold"
                            >
                                {project.name}
                            </Link>
                        </CardTitle>
                        <Badge className={getStatusColor(status)} variant="secondary">
                            {status}
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4 flex-1">


                    <div className="grid grid-cols-2 gap-y-2 text-xs text-slate-500">
                        <div className="flex items-center gap-1.5">
                            <Hash className="w-3.5 h-3.5 text-slate-400" />
                            <span className="truncate max-w-[100px]" title={project.id}>Project ID: <span className="text-slate-700">{project.id}</span></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3.5 h-3.5 flex items-center justify-center bg-slate-100 rounded-full text-[9px] font-bold text-slate-500">V</div>
                            <span>Release: <span className="text-slate-700 font-medium">{versionNumber}</span></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            {project.updatedAt && (
                                <div className="col-span-2 flex items-center gap-1.5 mt-1">
                                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Updated: <span className="text-slate-700">{new Date(project.updatedAt).toLocaleDateString()}</span></span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span>Created: <span className="text-slate-700">{new Date(project.createdAt).toLocaleDateString()}</span></span>
                        </div>

                    </div>
                </CardContent>
                <CardFooter className="flex justify-between gap-2">
                    <div className="flex gap-2">
                        <Button
                            disabled={!buildUrl}
                            onClick={() => window.open(buildUrl, '_blank')}
                            variant="outline"
                            size="sm"
                            className="h-8 px-2 lg:px-3"
                        >
                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                            Live Link
                        </Button>
                        {/* {buildUrl && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-500"
                                onClick={handleCopyLink}
                                title="Copy Link"
                            >
                                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            </Button>
                        )} */}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            onClick={() => navigate(`/projects/${project.id}`)}
                            size="sm"
                            className="h-8 text-white"
                        >
                            View Project
                        </Button>
                        <ProjectActionsDropdown
                            project={project}
                            user={{ role: 'admin' }} // Assuming admin rights for now or pass actual user
                            onGitDiff={() => setIsDiffModalOpen(true)}
                        />
                    </div>
                </CardFooter>
            </Card>

            <DiffModal
                isOpen={isDiffModalOpen}
                onClose={() => setIsDiffModalOpen(false)}
                projectId={project.id}
                projectName={project.name}
            />
        </>
    );
};

export default ProjectCard;

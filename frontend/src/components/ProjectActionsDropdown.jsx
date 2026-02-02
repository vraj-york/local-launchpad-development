import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History, FileText, MoreVertical } from 'lucide-react';

const ProjectActionsDropdown = ({ project, onGitDiff }) => {
    const navigate = useNavigate();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onGitDiff}>
                    <FileText className="mr-2 h-4 w-4" />
                    <span>View Git Diff</span>
                </DropdownMenuItem>

                {project.versions && project.versions.length > 0 && project.versions[0].buildUrl && (
                    <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}/diff`)}>
                        <History className="mr-2 h-4 w-4" />
                        <span>View All Changes</span>
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default ProjectActionsDropdown;
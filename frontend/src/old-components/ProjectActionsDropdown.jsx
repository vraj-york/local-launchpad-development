import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Settings, History, FileText } from 'lucide-react';

const ProjectActionsDropdown = ({ project, onGitDiff, onManage }) => {
    const navigate = useNavigate();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>

                <DropdownMenuItem onClick={onGitDiff}>
                    <FileText className="mr-2 h-4 w-4" />
                    <span>View Git Diff</span>
                </DropdownMenuItem>

                {onManage && (
                    <DropdownMenuItem onClick={onManage}>
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Manage Details</span>
                    </DropdownMenuItem>
                )}

                {project.versions && project.versions.length > 0 && project.versions[0].buildUrl && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}/diff`)}>
                            <History className="mr-2 h-4 w-4" />
                            <span>View All Changes</span>
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default ProjectActionsDropdown;
import React from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import ReleaseManagement from './ReleaseManagement';
import { Button } from './ui/button';

const ProjectDetails = () => {
    const { projectId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const projectName = location.state?.projectName || 'Project';

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-6">
                <Button
                    variant="ghost"
                    onClick={() => navigate('/projects')}
                    className="gap-2 pl-0 hover:bg-transparent hover:text-emerald-500"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    Back to Projects
                </Button>
            </div>
            <ReleaseManagement
                projectId={projectId}
                projectName={projectName}
            />
        </div>
    );
};

export default ProjectDetails;

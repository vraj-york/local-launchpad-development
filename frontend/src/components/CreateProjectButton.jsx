import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";

export const CreateProjectButton = () => {
    const navigate = useNavigate();

    const handleClick = () => {
        navigate('/projects/new');
    };

    return (
        <Button
            className="text-white gap-2"
            onClick={handleClick}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            Create New Project
        </Button>
    );
};

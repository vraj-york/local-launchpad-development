import React, { useState, useRef, useEffect } from 'react';

const ProjectActionsDropdown = ({ 
    project, 
    onGitDiff, 
    onManage,
    user 
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const toggleDropdown = (e) => {
        e.stopPropagation();
        setIsOpen(!isOpen);
    };

    const handleAction = (action) => {
        setIsOpen(false);
        action();
    };

    return (
        <div className="project-actions-dropdown" ref={dropdownRef}>
            <button 
                className="dropdown-trigger"
                onClick={toggleDropdown}
                aria-label="Project actions"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12,16A2,2 0 0,1 14,18C14,19.11 13.1,20 12,20C10.9,20 10,19.11 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12C14,13.11 13.1,14 12,14C10.9,14 10,13.11 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6C14,7.11 13.1,8 12,8C10.9,8 10,7.11 10,6A2,2 0 0,1 12,4Z"/>
                </svg>
            </button>
            
            {isOpen && (
                <div className="dropdown-menu">
                    <button 
                        className="dropdown-item"
                        onClick={() => handleAction(onGitDiff)}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z"/>
                        </svg>
                        Git Diff
                    </button>
                    
                    {onManage && (
                        <button 
                            className="dropdown-item"
                            onClick={() => handleAction(onManage)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z"/>
                            </svg>
                            Details
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default ProjectActionsDropdown;

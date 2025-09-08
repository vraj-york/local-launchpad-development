import React, { useState } from 'react';
import { createProject } from '../api';

const ProjectCreateForm = () => {
    const [projectName, setProjectName] = useState('');
    const [projectDescription, setProjectDescription] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        try {
            const response = await createProject({ name: projectName, description: projectDescription });
            if (response.status === 201) {
                setSuccess('Project created successfully!');
                setProjectName('');
                setProjectDescription('');
            }
        } catch (err) {
            setError('Failed to create project. Please try again.');
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <h2>Create New Project</h2>
            {error && <p className="error">{error}</p>}
            {success && <p className="success">{success}</p>}
            <div>
                <label htmlFor="projectName">Project Name:</label>
                <input
                    type="text"
                    id="projectName"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    required
                />
            </div>
            <div>
                <label htmlFor="projectDescription">Project Description:</label>
                <textarea
                    id="projectDescription"
                    value={projectDescription}
                    onChange={(e) => setProjectDescription(e.target.value)}
                    required
                />
            </div>
            <button type="submit">Create Project</button>
        </form>
    );
};

export default ProjectCreateForm;
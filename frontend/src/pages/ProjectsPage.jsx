import React, { useEffect, useState } from 'react';
import ProjectList from '../components/ProjectList';
import { fetchProjects } from '../api/index';

const ProjectsPage = () => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const getProjects = async () => {
            try {
                const data = await fetchProjects();
                setProjects(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        getProjects();
    }, []);

    if (loading) return <div>Loading projects...</div>;
    if (error) return <div>Error: {error}</div>;

    return (
        <div>
            <h1>Your Projects</h1>
            <ProjectList projects={projects} />
        </div>
    );
};

export default ProjectsPage;
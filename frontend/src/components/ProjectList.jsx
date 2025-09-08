import React, { useEffect, useState } from 'react';
import { fetchProjects } from '../api';

const ProjectList = () => {
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

    if (loading) {
        return <div>Loading projects...</div>;
    }

    if (error) {
        return <div>Error fetching projects: {error}</div>;
    }

    return (
        <div>
            <h2>Project List</h2>
            <ul>
                {projects.map(project => (
                    <li key={project.id}>
                        <a href={`/projects/${project.id}`}>{project.name}</a>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default ProjectList;
import React, { useEffect, useState } from 'react';
import ProjectList from '../components/ProjectList';
import { fetchProjects } from '../api/index';

const ProjectsPage = () => {
    const [projects, setProjects] = useState([]);
    const [filteredProjects, setFilteredProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const getProjects = async () => {
            try {
                const data = await fetchProjects();
                // Sort projects by creation date in descending order (newest first)
                const sortedProjects = data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                setProjects(sortedProjects);
                setFilteredProjects(sortedProjects);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        getProjects();
    }, []);

    // Filter projects based on search term
    useEffect(() => {
        if (searchTerm.trim() === '') {
            setFilteredProjects(projects);
        } else {
            const filtered = projects.filter(project =>
                project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (project.description && project.description.toLowerCase().includes(searchTerm.toLowerCase()))
            );
            setFilteredProjects(filtered);
        }
    }, [searchTerm, projects]);

    const handleSearchChange = (e) => {
        setSearchTerm(e.target.value);
    };

    if (loading) return <div>Loading projects...</div>;
    if (error) return <div>Error: {error}</div>;

    return (
        <div>
            <h1>Your Projects</h1>
            
            {/* Search Bar */}
            <div style={{ marginBottom: '20px' }}>
                <input
                    type="text"
                    placeholder="Search projects..."
                    value={searchTerm}
                    onChange={handleSearchChange}
                    style={{
                        width: '100%',
                        maxWidth: '400px',
                        padding: '10px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '16px'
                    }}
                />
            </div>

            <ProjectList projects={filteredProjects} />
        </div>
    );
};

export default ProjectsPage;
import React from 'react';

const ProjectList = ({ projects }) => {
    if (!projects || projects.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                No projects found. Create your first project to get started!
            </div>
        );
    }

    return (
        <div>
            <div style={{ marginBottom: '10px', color: '#666' }}>
                Showing {projects.length} project{projects.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'grid', gap: '15px' }}>
                {projects.map(project => (
                    <div 
                        key={project.id} 
                        style={{
                            border: '1px solid #ddd',
                            borderRadius: '8px',
                            padding: '20px',
                            backgroundColor: '#fff',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            transition: 'box-shadow 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                        }}
                    >
                        <h3 style={{ margin: '0 0 10px 0', color: '#333' }}>
                            <a 
                                href={`/projects/${project.id}`}
                                style={{ 
                                    textDecoration: 'none', 
                                    color: '#007bff',
                                    fontSize: '18px',
                                    fontWeight: '600'
                                }}
                            >
                                {project.name}
                            </a>
                        </h3>
                        {project.description && (
                            <p style={{ 
                                margin: '0 0 10px 0', 
                                color: '#666',
                                fontSize: '14px',
                                lineHeight: '1.4'
                            }}>
                                {project.description}
                            </p>
                        )}
                        <div style={{ 
                            fontSize: '12px', 
                            color: '#999',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <span>Created: {new Date(project.createdAt).toLocaleDateString()}</span>
                            <span>ID: {project.id}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ProjectList;
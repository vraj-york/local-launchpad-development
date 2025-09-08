import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Sidebar from './Sidebar';
import DashboardHome from './DashboardHome';
import ProjectManagement from './ProjectManagement';
import ProjectUpload from './ProjectUpload';
import ProjectView from './ProjectView';
import ProjectVersions from './ProjectVersions';

const Dashboard = () => {
    const { user, logout } = useAuth();
    const [activeTab, setActiveTab] = useState('dashboard');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [selectedProjectForVersions, setSelectedProjectForVersions] = useState(null);

    // Close sidebar on mobile when tab changes
    useEffect(() => {
        if (window.innerWidth <= 768) {
            setSidebarOpen(false);
        }
    }, [activeTab]);

    // Handle window resize
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth > 768) {
                setSidebarOpen(false);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const renderContent = () => {
        switch (activeTab) {
            case 'dashboard':
                return <DashboardHome setActiveTab={setActiveTab} />;
            case 'projects':
                return <ProjectManagement setActiveTab={setActiveTab} />;
            case 'upload':
                return <ProjectUpload />;
            case 'view':
                return <ProjectView setActiveTab={setActiveTab} setSelectedProjectForVersions={setSelectedProjectForVersions} />;
            case 'versions':
                return <ProjectVersions 
                    projectId={selectedProjectForVersions?.id || null} 
                    projectName={selectedProjectForVersions?.name || "All Projects"} 
                />;
            default:
                return <DashboardHome setActiveTab={setActiveTab} />;
        }
    };

    return (
        <div className="dashboard">
            <Sidebar 
                activeTab={activeTab} 
                setActiveTab={setActiveTab}
                user={user}
                logout={logout}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />
            
            {/* Mobile header */}
            <div className="mobile-header">
                <button 
                    className="mobile-menu-btn"
                    onClick={() => setSidebarOpen(true)}
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z"/>
                    </svg>
                </button>
                <h1>Zip Sync</h1>
            </div>

            {/* Overlay for mobile */}
            {sidebarOpen && (
                <div 
                    className="sidebar-overlay"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            <main className="main-content">
                {renderContent()}
            </main>
        </div>
    );
};

export default Dashboard;

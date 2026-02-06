import React, { useState, useEffect } from 'react';
import { createProject, fetchManagers } from '../api';
import { useAuth } from '../context/AuthContext';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from 'react-router-dom';
import { Loader2 } from "lucide-react";
import { PageHeader } from '@/components/PageHeader';
import RoadMapManagement from '@/components/RoadMapManagement';
import { toast } from 'sonner';

const CreateProject = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // Form State
    const [projectName, setProjectName] = useState('');
    const [projectDescription, setProjectDescription] = useState('');
    const [managers, setManagers] = useState([]);
    const [selectedManager, setSelectedManager] = useState('');

    // GitHub Config State
    const [githubToken, setGithubToken] = useState('');
    const [githubUsername, setGithubUsername] = useState('');

    // Jira Config State
    const [jiraBaseUrl, setJiraBaseUrl] = useState('');
    const [jiraUsername, setJiraUsername] = useState('');
    const [jiraApiToken, setJiraApiToken] = useState('');
    const [jiraProjectKey, setJiraProjectKey] = useState('');
    const [jiraIssueType, setJiraIssueType] = useState('');

    // Roadmap State
    const [defaultRoadmapId] = useState(Date.now().toString());

    const [roadmaps, setRoadmaps] = useState([{
        id: defaultRoadmapId,
        title: "",
        description: "",
        status: "DRAFT",
        tshirtSize: "M",
        timelineStart: "",
        timelineEnd: "",
        items: [{
            id: `${Date.now()}-1`,
            title: "",
            description: "",
            status: "PLANNED",
            type: "FEATURE",
            priority: "MEDIUM",
            startDate: "",
            endDate: ""
        }]
    }]);

    // UI State
    const [error, setError] = useState('');
    const [validationErrors, setValidationErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [managersLoading, setManagersLoading] = useState(false);

    // Load managers if admin
    useEffect(() => {
        if (user?.role === 'admin') {
            const loadManagers = async () => {
                setManagersLoading(true);
                try {
                    const data = await fetchManagers();
                    setManagers(data);
                } catch (err) {
                    console.error('Failed to fetch managers:', err);
                    setError('Failed to load managers. Please refresh.');
                } finally {
                    setManagersLoading(false);
                }
            };
            loadManagers();
        }
    }, [user]);

    const validateForm = () => {
        const errors = {};

        // Project Validation
        if (!projectName.trim()) errors.projectName = "Project name is required";
        if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) {
            errors.projectName = "Project name can only contain letters, numbers, hyphens, and underscores";
        }
        if (user?.role === 'admin' && !selectedManager) errors.manager = "Manager is required";

        // Roadmap Validation
        if (roadmaps.length === 0) {
            errors.roadmaps = "At least one roadmap is required";
        } else {
            roadmaps.forEach(roadmap => {
                if (!roadmap.title.trim()) errors[`roadmap-${roadmap.id}-title`] = "Roadmap title is required";
                if (!roadmap.timelineStart) errors[`roadmap-${roadmap.id}-timelineStart`] = "Start date is required";
                if (!roadmap.timelineEnd) errors[`roadmap-${roadmap.id}-timelineEnd`] = "End date is required";

                if (roadmap.items.length === 0) {
                    errors[`roadmap-${roadmap.id}-items`] = "At least one item is required";
                } else {
                    roadmap.items.forEach(item => {
                        if (!item.title.trim()) errors[`item-${item.id}-title`] = "Item title is required";
                        if (!item.startDate) errors[`item-${item.id}-startDate`] = "Start date is required";
                        if (!item.endDate) errors[`item-${item.id}-endDate`] = "End date is required";
                    });
                }
            });
        }

        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setValidationErrors({});

        if (!validateForm()) {
            toast.error("Please fix the validation errors");
            return;
        }

        setLoading(true);

        try {
            // Process roadmaps: remove UI IDs and format dates
            const processedRoadmaps = roadmaps.map(roadmap => {
                const { id, ...roadmapRest } = roadmap;
                return {
                    ...roadmapRest,
                    timelineStart: new Date(roadmap.timelineStart).toISOString(),
                    timelineEnd: new Date(roadmap.timelineEnd).toISOString(),
                    items: (roadmap.items || []).map(item => {
                        const { id: itemId, ...itemRest } = item;
                        return {
                            ...itemRest,
                            startDate: new Date(item.startDate).toISOString(),
                            endDate: new Date(item.endDate).toISOString(),
                            priority: item.priority || "MEDIUM" // Ensure priority exists
                        };
                    })
                };
            });

            const projectData = {
                name: projectName,
                description: projectDescription,
                roadmaps: processedRoadmaps,
            };

            if (user?.role === 'admin') {
                projectData.assignedManagerId = parseInt(selectedManager);
            } else if (user?.role === 'manager') {
                projectData.assignedManagerId = user.id;
            }

            console.log("Submitting Project Data:", projectData);
            const response = await createProject(projectData);
            console.log("Project  response:", response);
            toast.success("Project created successfully");

            // Navigate to the new project or dashboard
            navigate('/dashboard');

        } catch (err) {
            console.error(err);
            toast.error(err.error || 'Failed to create project. Please try again.');
            setError(err.error || 'Failed to create project. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto">
            <PageHeader title="Create New Project" description="Start a new project workspace." />
            <form onSubmit={handleSubmit} className="space-y-6">
                <Card className="border-slate-200">
                    <CardContent className="space-y-6 pt-6">
                        {error && (
                            <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md">
                                {error}
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Project Name</Label>
                                    <Input
                                        id="name"
                                        placeholder="e.g. Website Redesign"
                                        value={projectName}
                                        onChange={(e) => setProjectName(e.target.value)}
                                        className={`text-lg ${validationErrors.projectName ? "border-destructive" : ""}`}
                                    />
                                    {validationErrors.projectName && (
                                        <p className="text-sm text-destructive mt-1">{validationErrors.projectName}</p>
                                    )}
                                </div>
                                {user?.role === 'admin' && (
                                    <div className="space-y-2">
                                        <Label htmlFor="manager">Assigned Manager</Label>
                                        <Select
                                            value={selectedManager}
                                            onValueChange={setSelectedManager}
                                            disabled={managersLoading}

                                        >
                                            <SelectTrigger className={validationErrors.manager ? "border-destructive w-full" : "w-full"}>
                                                <SelectValue placeholder={managersLoading ? "Loading managers..." : "Select a manager"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {managers.map((manager) => (
                                                    <SelectItem key={manager.id} value={manager.id.toString()}>
                                                        {manager.name} ({manager.email})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {validationErrors.manager && (
                                            <p className="text-sm text-destructive mt-1">{validationErrors.manager}</p>
                                        )}
                                        {managersLoading && <p className="text-xs text-muted-foreground">Fetching list of managers...</p>}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="description">Description</Label>
                                <Textarea
                                    id="description"
                                    placeholder="What is this project about?"
                                    value={projectDescription}
                                    onChange={(e) => setProjectDescription(e.target.value)}
                                    rows={4}
                                    className="resize-y min-h-[100px]"
                                />
                            </div>


                        </div>
                    </CardContent>
                </Card>

                {/* GitHub Configuration Card */}
                <Card className="border-slate-200">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-800">GitHub Configuration (Optional)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="githubUsername">GitHub Username</Label>
                                <Input
                                    id="githubUsername"
                                    placeholder="test-user"
                                    value={githubUsername}
                                    onChange={(e) => setGithubUsername(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="githubToken">GitHub Personal Access Token</Label>
                                <Input
                                    id="githubToken"
                                    type="password"
                                    placeholder="ghp_..."
                                    value={githubToken}
                                    onChange={(e) => setGithubToken(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Jira Configuration Card */}
                <Card className="border-slate-200">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-800">Jira Configuration (Optional)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="jiraBaseUrl">Jira Base URL</Label>
                                <Input
                                    id="jiraBaseUrl"
                                    placeholder="e.g. https://your-domain.atlassian.net"
                                    value={jiraBaseUrl}
                                    onChange={(e) => setJiraBaseUrl(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="jiraUsername">Jira Username (Email)</Label>
                                <Input
                                    id="jiraUsername"
                                    placeholder="user@example.com"
                                    value={jiraUsername}
                                    onChange={(e) => setJiraUsername(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="jiraProjectKey">Project Key</Label>
                                <Input
                                    id="jiraProjectKey"
                                    placeholder="e.g. PROJ"
                                    value={jiraProjectKey}
                                    onChange={(e) => setJiraProjectKey(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="jiraIssueType">Default Issue Type</Label>
                                <Input
                                    id="jiraIssueType"
                                    placeholder="e.g. Bug"
                                    value={jiraIssueType}
                                    onChange={(e) => setJiraIssueType(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="jiraApiToken">Jira API Token</Label>
                            <Input
                                id="jiraApiToken"
                                type="password"
                                placeholder="Jira API Token"
                                value={jiraApiToken}
                                onChange={(e) => setJiraApiToken(e.target.value)}
                            />
                        </div>
                    </CardContent>
                </Card>


                {/* Roadmap Configuration */}
                <Card className="border-slate-200">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-800">Project Roadmap</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <RoadMapManagement
                            value={roadmaps}
                            onChange={setRoadmaps}
                            isEmbedded={true}
                            validationErrors={validationErrors}
                            initialEditingId={defaultRoadmapId}
                        />
                    </CardContent>
                </Card>

                <Button
                    type="submit"
                    disabled={loading || (user?.role === 'admin' && managersLoading)}
                    className="px-8"
                >
                    {loading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Creating...
                        </>
                    ) : (
                        'Create Project'
                    )}
                </Button>

            </form>
        </div>
    );
};

export default CreateProject;

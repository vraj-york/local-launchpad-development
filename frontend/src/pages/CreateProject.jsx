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
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from 'react-router-dom';
import { Loader2 } from "lucide-react";

const CreateProject = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // Form State
    const [projectName, setProjectName] = useState('');
    const [projectDescription, setProjectDescription] = useState('');
    const [managers, setManagers] = useState([]);
    const [selectedManager, setSelectedManager] = useState('');

    // UI State
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [managersLoading, setManagersLoading] = useState(false);
    const [draftFound, setDraftFound] = useState(false);

    // Load draft on mount
    useEffect(() => {
        const draft = localStorage.getItem('project_creation_draft');
        if (draft) {
            try {
                const parsedDraft = JSON.parse(draft);
                if (parsedDraft.name || parsedDraft.description || parsedDraft.manager) {
                    setProjectName(parsedDraft.name || '');
                    setProjectDescription(parsedDraft.description || '');
                    setSelectedManager(parsedDraft.manager || '');
                    setDraftFound(true);
                }
            } catch (e) {
                console.error("Failed to parse draft", e);
            }
        }
    }, []);

    // Save draft on change
    useEffect(() => {
        const draft = {
            name: projectName,
            description: projectDescription,
            manager: selectedManager
        };
        // Only save if there's actually something to save
        if (projectName || projectDescription || selectedManager) {
            localStorage.setItem('project_creation_draft', JSON.stringify(draft));
        }
    }, [projectName, projectDescription, selectedManager]);

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

    const handleClearDraft = () => {
        localStorage.removeItem('project_creation_draft');
        setProjectName('');
        setProjectDescription('');
        setSelectedManager('');
        setDraftFound(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (user?.role === 'admin' && !selectedManager) {
            setError('Please select a manager');
            return;
        }

        setLoading(true);

        try {
            const projectData = {
                name: projectName,
                description: projectDescription
            };

            if (user?.role === 'admin') {
                projectData.assignedManagerId = parseInt(selectedManager);
            } else if (user?.role === 'manager') {
                projectData.assignedManagerId = user.id;
            }

            const response = await createProject(projectData);

            // Clear draft on success
            localStorage.removeItem('project_creation_draft');

            // Navigate to the new project or dashboard (for now dashboard as requested)
            // Ideally we'd go to `/projects/${response.id}` but let's stick to simple flow first
            navigate('/dashboard');

        } catch (err) {
            setError(err.error || 'Failed to create project. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto">
            <div className="mb-8 flex w-full justify-between">
                <div>
                    <h1 className="text-xl font-bold text-slate-800 tracking-tight">
                        Create New Project
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Start a new project workspace.
                    </p>
                </div>
            </div>
            <Card className="border-slate-200">
                <form onSubmit={handleSubmit}>
                    <CardContent className="space-y-6">
                        {error && (
                            <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="name">Project Name <span className="text-destructive">*</span></Label>
                            <Input
                                id="name"
                                placeholder="e.g. Website Redesign"
                                value={projectName}
                                onChange={(e) => setProjectName(e.target.value)}
                                required
                                className="text-lg"
                            />
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

                        {user?.role === 'admin' && (
                            <div className="space-y-2">
                                <Label htmlFor="manager">Assigned Manager <span className="text-destructive">*</span></Label>
                                <Select
                                    value={selectedManager}
                                    onValueChange={setSelectedManager}
                                    required
                                    disabled={managersLoading}
                                >
                                    <SelectTrigger>
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
                                {managersLoading && <p className="text-xs text-muted-foreground">Fetching list of managers...</p>}
                            </div>
                        )}
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
                    </CardContent>
                </form>
            </Card>
        </div>
    );
};

export default CreateProject;

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProjectsPage from '@/pages/ProjectsPage';
import { ProjectCreateDialog } from './ProjectCreateDialog';
import { CreateProjectButton } from './CreateProjectButton';

export const Projects = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setIsCreateDialogOpen(true);
    }
  }, [searchParams]);

  const handleOpenChange = (open) => {
    setIsCreateDialogOpen(open);
    if (!open) {
      // Remove query param when closing
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('create');
      setSearchParams(newParams);
    }
  };

  const handleSuccess = () => {
    // Optionally refresh projects list. 
    // Since ProjectsPage fetches on mount, we might need a way to trigger refresh.
    // For now, we'll rely on the user refreshing or basic behavior. 
    // Ideal: pass a refresh trigger to ProjectsPage.
    // But ProjectsPage logic is inside the component.
    // We can reload the page or just let it close.
    handleOpenChange(false);
    window.location.reload(); // Simple brute force refresh to show new project 
  }

  return <>
    <div>
      <div className="mb-8 flex w-full justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Projects
          </h1>
          <p className="text-muted-foreground text-sm">
            Manage and organize your projects
          </p>
        </div>
        <CreateProjectButton />
      </div>
      <ProjectsPage />
      <ProjectCreateDialog
        open={isCreateDialogOpen}
        onOpenChange={handleOpenChange}
        onSuccess={handleSuccess}
      />
    </div>
  </>
}

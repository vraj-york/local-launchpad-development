import React from 'react';
import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';

export const MainLayout = () => {
    return (
        <SidebarProvider>
            <AppSidebar />
            <main className="flex-1 flex flex-col min-h-screen bg-gray-50 w-full overflow-hidden">
                <div className="p-2 flex items-center">
                    <SidebarTrigger />
                </div>
                <div className="flex-1 px-4 pb-4 md:px-6 md:pb-6 overflow-y-auto">
                    <div className="bg-white rounded-xl p-6 min-h-full ">
                        <Outlet />
                    </div>
                </div>
            </main>
        </SidebarProvider>
    );
};

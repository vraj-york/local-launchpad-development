import React from 'react'

export const PageHeader = ({ title, description, children }) => {
    return (
        <div className="mb-8 w-full flex justify-between items-center">
            <div className='flex flex-col item-center'>
                <h1 className="text-xl font-bold text-slate-800 tracking-tight">
                    {title}
                </h1>
                <p className="text-muted-foreground text-sm">
                    {description}
                </p>
            </div>
            <div>
                {children}
            </div>
        </div>
    )
}

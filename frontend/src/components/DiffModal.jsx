import React, { useState } from 'react';
import { fetchProjectDiff, generateJiraTickets } from '../api';
import { toast } from 'sonner';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";

const DiffModal = ({ isOpen, onClose, projectId, projectName }) => {

    const [diffData, setDiffData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [jiraLoading, setJiraLoading] = useState(false);
    const [jiraResult, setJiraResult] = useState(null);
    const [jiraError, setJiraError] = useState(null);

    const handleFetchDiff = async () => {
        if (!projectId) return;

        setLoading(true);
        setError(null);
        toast.info('Generating git diff summary...');

        try {
            const data = await fetchProjectDiff(projectId);
            console.log('🔍 Full API Response:', data);
            setDiffData(data);
            toast.success('Git diff summary generated successfully!');
        } catch (err) {
            const errorMessage = err.message || 'Failed to fetch diff summary';
            setError(errorMessage);
            toast.error(`Failed to generate summary: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setDiffData(null);
        setError(null);
        setJiraResult(null);
        setJiraError(null);
        onClose();
    };


    const handleGenerateJiraTickets = async () => {
        if (!projectId) return;

        setJiraLoading(true);
        setJiraError(null);
        setJiraResult(null);
        toast.info('Creating Jira tickets...');

        try {
            const result = await generateJiraTickets(projectId);
            console.log('🎫 Jira Result:', result);
            setJiraResult(result);

            if (result.success) {
                toast.success(`Successfully created ${result.successfulTickets} Jira tickets!`);
            } else {
                toast.error(`Failed to create Jira tickets: ${result.error || result.message}`);
            }
        } catch (err) {
            console.error('❌ Jira Error:', err);
            const errorMessage = err.message || 'Failed to generate Jira tickets';
            setJiraError(errorMessage);
            toast.error(`Failed to create Jira tickets: ${errorMessage}`);
        } finally {
            setJiraLoading(false);
        }
    };

    const handleDownloadDocx = async () => {
        if (!diffData) return;

        try {
            toast.info('Generating DOCX document...');
            const doc = new Document({
                sections: [{
                    properties: {},
                    children: [
                        new Paragraph({
                            text: `Git Diff Summary - ${projectName}`,
                            heading: HeadingLevel.TITLE,
                        }),
                        new Paragraph({
                            text: `Project: ${diffData.projectName}`,
                            heading: HeadingLevel.HEADING_1,
                        }),
                        new Paragraph({
                            text: `Repository: ${diffData.repository}`,
                        }),
                        new Paragraph({
                            text: `From: ${diffData.from}`,
                        }),
                        new Paragraph({
                            text: `To: ${diffData.to}`,
                        }),
                        new Paragraph({
                            text: "Summary:",
                            heading: HeadingLevel.HEADING_2,
                        }),
                        ...(diffData.summary && typeof diffData.summary === 'object' ?
                            // Handle new batching response structure
                            (diffData.summary.summary ?
                                (diffData.summary.summary.includes('--- Chunk Summary ---') ?
                                    // Combine all chunks into a single list of points
                                    diffData.summary.summary
                                        .split('--- Chunk Summary ---')
                                        .flatMap(chunk =>
                                            chunk.trim()
                                                .split('\n')
                                                .filter(line => line.trim())
                                                .map(line => line.replace(/^[-•]\s*/, '').trim())
                                                .filter(line => line)
                                        )
                                        .map(point =>
                                            new Paragraph({
                                                text: point,
                                                bullet: { level: 0 }
                                            })
                                        ) :
                                    // Handle single summary
                                    [new Paragraph({
                                        text: diffData.summary.summary,
                                    })]
                                ) :
                                // Handle old response structure
                                (diffData.summary.output?.Summary ?
                                    diffData.summary.output.Summary.split('\n').map(line =>
                                        new Paragraph({
                                            text: line.replace(/^-\s*/, ''),
                                            bullet: line.startsWith('-') ? { level: 0 } : undefined,
                                        })
                                    ) :
                                    [new Paragraph({
                                        text: 'No summary available',
                                    })]
                                )
                            ) :
                            [new Paragraph({
                                text: diffData.summary || 'No summary available',
                            })]
                        ),
                    ],
                }],
            });

            const blob = await Packer.toBlob(doc);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `git-diff-summary-${projectName}-${new Date().toISOString().split('T')[0]}.docx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            toast.success('DOCX document downloaded successfully!');
        } catch (error) {
            console.error('Error generating DOCX:', error);
            toast.error('Failed to generate DOCX file. Please try again.');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="sm:max-w-[900px] max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Git Diff Summary - {projectName}</DialogTitle>
                    <DialogDescription>
                        View changes, download summary, or generate Jira tickets.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto pr-2">
                    {!diffData && !loading && !error && (
                        <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                            <div className="bg-slate-100 p-4 rounded-full mb-4">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="text-slate-400">
                                    <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                                </svg>
                            </div>
                            <h4 className="text-lg font-semibold text-slate-700 mb-2">View Git Changes</h4>
                            <p className="text-sm mb-6 max-w-sm">Get a summary of the latest changes in this project's git repository.</p>
                            <Button
                                onClick={handleFetchDiff}
                                disabled={loading}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                                {loading ? 'Loading...' : 'Generate Summary'}
                            </Button>
                        </div>
                    )}

                    {loading && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
                            <p className="text-slate-500">Generating diff summary...</p>
                        </div>
                    )}

                    {error && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <div className="bg-red-50 p-4 rounded-full mb-4 text-red-500">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z" />
                                </svg>
                            </div>
                            <h4 className="text-lg font-semibold text-slate-800 mb-2">Error Loading Diff</h4>
                            <p className="text-red-600 mb-6 max-w-sm">{error}</p>
                            <Button
                                variant="outline"
                                onClick={handleFetchDiff}
                            >
                                Try Again
                            </Button>
                        </div>
                    )}

                    {diffData && (
                        <div className="space-y-6">
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                <div className="flex justify-between items-start mb-4">
                                    <h4 className="font-semibold text-slate-800">Changes Summary</h4>
                                    <a
                                        href={diffData.repository}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1 hover:underline"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12,2A10,10 0 0,0 2,12C2,16.42 4.87,20.17 8.84,21.5C9.34,21.58 9.5,21.27 9.5,21C9.5,20.77 9.5,20.14 9.5,19.31C6.73,19.91 6.14,17.97 6.14,17.97C5.68,16.81 5.03,16.5 5.03,16.5C4.12,15.88 5.1,15.9 5.1,15.9C6.1,15.97 6.63,16.93 6.63,16.93C7.5,18.45 8.97,18 9.54,17.76C9.63,17.11 9.89,16.67 10.17,16.42C7.95,16.17 5.62,15.31 5.62,11.5C5.62,10.39 6,9.5 6.65,8.79C6.55,8.54 6.2,7.5 6.75,6.15C6.75,6.15 7.59,5.88 9.5,7.17C10.29,6.95 11.15,6.84 12,6.84C12.85,6.84 13.71,6.95 14.5,7.17C16.41,5.88 17.25,6.15 17.25,6.15C17.8,7.5 17.45,8.54 17.35,8.79C18,9.5 18.38,10.39 18.38,11.5C18.38,15.32 16.04,16.16 13.81,16.41C14.17,16.72 14.5,17.33 14.5,18.26C14.5,19.6 14.5,20.68 14.5,21C14.5,21.27 14.66,21.59 15.17,21.5C19.14,20.16 22,16.42 22,12A10,10 0 0,0 12,2Z" />
                                        </svg>
                                        View Repository
                                    </a>
                                </div>
                                <div className="flex gap-4 text-sm text-slate-600 font-mono bg-white p-2 rounded border border-slate-100">
                                    <span className="flex items-center gap-2">
                                        <span className="text-slate-400">From:</span> {diffData.from?.substring(0, 8)}...
                                    </span>
                                    <span className="text-slate-300">|</span>
                                    <span className="flex items-center gap-2">
                                        <span className="text-slate-400">To:</span> {diffData.to?.substring(0, 8)}...
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <h5 className="font-semibold text-slate-800 mb-2">Summary</h5>
                                    <div className="bg-white border border-slate-200 rounded-lg p-4 text-sm text-slate-700 leading-relaxed max-h-[400px] overflow-y-auto">
                                        {diffData.summary && typeof diffData.summary === 'object' ? (
                                            <div className="space-y-4">
                                                {/* Handle new batching response structure */}
                                                {diffData.summary.summary && (
                                                    <div>
                                                        <h6 className="font-semibold text-slate-900 mb-2">Changes Made:</h6>
                                                        <div className="prose prose-sm max-w-none text-slate-600">
                                                            {diffData.summary.summary.includes('--- Chunk Summary ---') ? (
                                                                <ul className="list-disc pl-5 space-y-1">
                                                                    {diffData.summary.summary
                                                                        .split('--- Chunk Summary ---')
                                                                        .flatMap(chunk =>
                                                                            chunk.trim()
                                                                                .split('\n')
                                                                                .filter(line => line.trim())
                                                                                .map(line => line.replace(/^[-•]\s*/, '').trim())
                                                                                .filter(line => line)
                                                                        )
                                                                        .map((point, index) => (
                                                                            <li key={index}>
                                                                                {point}
                                                                            </li>
                                                                        ))
                                                                    }
                                                                </ul>
                                                            ) : (
                                                                <p className="whitespace-pre-wrap">{diffData.summary.summary}</p>
                                                            )}
                                                        </div>
                                                        {diffData.summary.aggregated && (
                                                            <div className="mt-3 px-3 py-2 bg-blue-50 text-blue-700 rounded text-xs border border-blue-100 font-medium inline-block">
                                                                Batch Processing: {diffData.summary.successfulChunks}/{diffData.summary.totalChunks} chunks processed successfully
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Handle old response structure */}
                                                {diffData.summary.output?.Summary && (
                                                    <div>
                                                        <h6 className="font-semibold text-slate-900 mb-2">Changes Made:</h6>
                                                        <ul className="list-disc pl-5 space-y-1">
                                                            {diffData.summary.output.Summary.split("\n").map((change, index) => (
                                                                <li key={index}>{change.replace(/^-\s*/, "")}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}

                                                {diffData.summary.files && (
                                                    <div>
                                                        <h6 className="font-semibold text-slate-900 mb-2">Files Modified:</h6>
                                                        <ul className="list-disc pl-5 space-y-1 font-mono text-xs">
                                                            {Array.isArray(diffData.summary.files) ?
                                                                diffData.summary.files.map((file, index) => (
                                                                    <li key={index}>
                                                                        <code className="text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded">{file}</code>
                                                                    </li>
                                                                )) :
                                                                <li><code className="text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded">{diffData.summary.files}</code></li>
                                                            }
                                                        </ul>
                                                    </div>
                                                )}
                                                {diffData.summary.impact && (
                                                    <div>
                                                        <h6 className="font-semibold text-slate-900 mb-2">Impact:</h6>
                                                        <p>{diffData.summary.impact}</p>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div>
                                                <p>{typeof diffData.summary === 'string' ? diffData.summary : (diffData.summary || 'No summary available')}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Actions Toolbar */}
                            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                                <Button
                                    variant="outline"
                                    onClick={handleFetchDiff}
                                >
                                    Refresh
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={handleDownloadDocx}
                                    className="gap-2"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                                    </svg>
                                    Download DOCX
                                </Button>
                                <Button
                                    onClick={handleGenerateJiraTickets}
                                    disabled={jiraLoading}
                                    className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                    {jiraLoading ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                            Creating...
                                        </>
                                    ) : (
                                        <>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                                            </svg>
                                            Generate Jira Tickets
                                        </>
                                    )}
                                </Button>
                            </div>

                            {/* Jira Results Section */}
                            {jiraResult && (
                                <div className={`mt-6 p-5 rounded-lg border ${jiraResult.success ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
                                    }`}>
                                    <h5 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${jiraResult.success ? 'text-emerald-800' : 'text-red-800'
                                        }`}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                            {jiraResult.success ?
                                                <path d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z" /> :
                                                <path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z" />
                                            }
                                        </svg>
                                        {jiraResult.success ? 'Jira Tickets Created Successfully!' : 'Failed to Create Jira Tickets'}
                                    </h5>

                                    {jiraResult.success && (
                                        <div className="space-y-3">
                                            <p className="text-sm">
                                                <strong>Status:</strong> {jiraResult.message}
                                            </p>
                                            <p className="text-sm">
                                                <strong>Total Tickets:</strong> {jiraResult.totalTickets} |
                                                <strong> Successful:</strong> {jiraResult.successfulTickets} |
                                                <strong> Failed:</strong> {jiraResult.failedTickets}
                                            </p>

                                            {jiraResult.tickets?.created && jiraResult.tickets.created.length > 0 && (
                                                <div className="bg-white/50 p-3 rounded border border-emerald-100">
                                                    <h6 className="font-semibold text-emerald-900 text-sm mb-2">Created Tickets:</h6>
                                                    <ul className="space-y-2">
                                                        {jiraResult.tickets.created.map((ticket, index) => (
                                                            <li key={index} className="text-sm">
                                                                <span className="font-medium text-slate-800">{ticket.key}:</span> {ticket.title}
                                                                <br />
                                                                <a href={ticket.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1 mt-1">
                                                                    View in Jira →
                                                                </a>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            {jiraResult.tickets?.failed && jiraResult.tickets.failed.length > 0 && (
                                                <div className="bg-red-50 p-3 rounded border border-red-100">
                                                    <h6 className="font-semibold text-red-900 text-sm mb-2">Failed Tickets:</h6>
                                                    <ul className="space-y-1">
                                                        {jiraResult.tickets.failed.map((ticket, index) => (
                                                            <li key={index} className="text-sm text-red-700">
                                                                <span className="font-medium">{ticket.title}:</span> {ticket.error}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!jiraResult.success && (
                                        <div className="bg-white/50 p-3 rounded border border-red-100 text-red-800 text-sm">
                                            <strong>Error:</strong> {jiraResult.error || jiraResult.message}
                                        </div>
                                    )}

                                    {jiraResult.success && (
                                        <div className="bg-emerald-100/50 p-3 rounded border border-emerald-100 mt-2 text-sm text-emerald-900">
                                            <strong>Next Steps:</strong>
                                            <ul className="list-disc pl-5 mt-1">
                                                <li>Check your Jira project for the newly created tickets</li>
                                                <li>Tickets are automatically labeled and categorized</li>
                                                <li>Review and assign tickets to team members as needed</li>
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}

                            {jiraError && (
                                <div className="mt-6 p-5 rounded-lg border bg-red-50 border-red-200">
                                    <h5 className="flex items-center gap-2 text-red-800 font-semibold mb-2">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z" />
                                        </svg>
                                        Failed to Create Jira Tickets
                                    </h5>
                                    <p className="text-red-700 text-sm mb-3"><strong>Error:</strong> {jiraError}</p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleGenerateJiraTickets}
                                        className="border-red-200 text-red-700 hover:bg-red-100"
                                    >
                                        Try Again
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default DiffModal;

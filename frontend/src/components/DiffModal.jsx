import React, { useState } from 'react';
import { fetchProjectDiff, generateJiraTickets } from '../api';
import { useToast } from '../context/ToastContext';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

const DiffModal = ({ isOpen, onClose, projectId, projectName }) => {
    const { showSuccess, showError, showInfo } = useToast();
    const [diffData, setDiffData] = useState(null);
    console.log('🔍 diffData:', diffData);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [jiraLoading, setJiraLoading] = useState(false);
    const [jiraResult, setJiraResult] = useState(null);
    const [jiraError, setJiraError] = useState(null);

    const handleFetchDiff = async () => {
        if (!projectId) return;
        
        setLoading(true);
        setError(null);
        showInfo('Generating git diff summary...');
        
        try {
            const data = await fetchProjectDiff(projectId);
            console.log('🔍 Full API Response:', data);
            console.log('🔍 Summary Structure:', data.summary);
            console.log('🔍 Summary Type:', typeof data.summary);
            setDiffData(data);
            showSuccess('Git diff summary generated successfully!');
        } catch (err) {
            const errorMessage = err.message || 'Failed to fetch diff summary';
            setError(errorMessage);
            showError(`Failed to generate summary: ${errorMessage}`);
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
        showInfo('Creating Jira tickets...');
        
        try {
            const result = await generateJiraTickets(projectId);
            console.log('🎫 Jira Result:', result);
            setJiraResult(result);
            
            if (result.success) {
                showSuccess(`Successfully created ${result.successfulTickets} Jira tickets!`);
            } else {
                showError(`Failed to create Jira tickets: ${result.error || result.message}`);
            }
        } catch (err) {
            console.error('❌ Jira Error:', err);
            const errorMessage = err.message || 'Failed to generate Jira tickets';
            setJiraError(errorMessage);
            showError(`Failed to create Jira tickets: ${errorMessage}`);
        } finally {
            setJiraLoading(false);
        }
    };

    const handleDownloadDocx = async () => {
        if (!diffData) return;

        try {
            showInfo('Generating DOCX document...');
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
            showSuccess('DOCX document downloaded successfully!');
        } catch (error) {
            console.error('Error generating DOCX:', error);
            showError('Failed to generate DOCX file. Please try again.');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Git Diff Summary - {projectName}</h3>
                    <button className="modal-close" onClick={handleClose}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
                        </svg>
                    </button>
                </div>
                
                <div className="modal-body">
                    {!diffData && !loading && !error && (
                        <div className="diff-intro">
                            <div className="diff-intro-icon">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z"/>
                                </svg>
                            </div>
                            <h4>View Git Changes</h4>
                            <p>Get a summary of the latest changes in this project's git repository.</p>
                            <button 
                                className="btn btn-primary"
                                onClick={handleFetchDiff}
                                disabled={loading}
                            >
                                {loading ? 'Loading...' : 'Generate Summary'}
                            </button>
                        </div>
                    )}

                    {loading && (
                        <div className="loading-state">
                            <div className="loading-spinner"></div>
                            <p>Generating diff summary...</p>
                        </div>
                    )}

                    {error && (
                        <div className="error-state">
                            <div className="error-icon">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z"/>
                                </svg>
                            </div>
                            <h4>Error Loading Diff</h4>
                            <p>{error}</p>
                            <button 
                                className="btn btn-outline"
                                onClick={handleFetchDiff}
                            >
                                Try Again
                            </button>
                        </div>
                    )}

                    {diffData && (
                        <div className="diff-content">
                            <div className="diff-header">
                                <div className="diff-info">
                                    <h4>Changes Summary</h4>
                                    <div className="diff-meta">
                                        <span className="diff-commit">
                                            <strong>From:</strong> {diffData.from?.substring(0, 8)}...
                                        </span>
                                        <span className="diff-commit">
                                            <strong>To:</strong> {diffData.to?.substring(0, 8)}...
                                        </span>
                                    </div>
                                    <div className="diff-repo">
                                        <a 
                                            href={diffData.repository} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="repo-link"
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                                <path d="M12,2A10,10 0 0,0 2,12C2,16.42 4.87,20.17 8.84,21.5C9.34,21.58 9.5,21.27 9.5,21C9.5,20.77 9.5,20.14 9.5,19.31C6.73,19.91 6.14,17.97 6.14,17.97C5.68,16.81 5.03,16.5 5.03,16.5C4.12,15.88 5.1,15.9 5.1,15.9C6.1,15.97 6.63,16.93 6.63,16.93C7.5,18.45 8.97,18 9.54,17.76C9.63,17.11 9.89,16.67 10.17,16.42C7.95,16.17 5.62,15.31 5.62,11.5C5.62,10.39 6,9.5 6.65,8.79C6.55,8.54 6.2,7.5 6.75,6.15C6.75,6.15 7.59,5.88 9.5,7.17C10.29,6.95 11.15,6.84 12,6.84C12.85,6.84 13.71,6.95 14.5,7.17C16.41,5.88 17.25,6.15 17.25,6.15C17.8,7.5 17.45,8.54 17.35,8.79C18,9.5 18.38,10.39 18.38,11.5C18.38,15.32 16.04,16.16 13.81,16.41C14.17,16.72 14.5,17.33 14.5,18.26C14.5,19.6 14.5,20.68 14.5,21C14.5,21.27 14.66,21.59 15.17,21.5C19.14,20.16 22,16.42 22,12A10,10 0 0,0 12,2Z"/>
                                            </svg>
                                            View Repository
                                        </a>
                                    </div>
                                </div>
                            </div>

                            <div className="diff-summary">
                                <h5>Summary</h5>
                                <div className="summary-content">
                                    {diffData.summary && typeof diffData.summary === 'object' ? (
                                        <div className="summary-structured">
                                            {/* Handle new batching response structure */}
                                            {diffData.summary.summary && (
                                                <div className="summary-section">
                                                    <h6>Changes Made:</h6>
                                                    <div className="summary-text">
                                                        {diffData.summary.summary.includes('--- Chunk Summary ---') ? (
                                                            // Combine all chunks into a single list of points
                                                            <ul>
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
                                                                        <li key={index} style={{ marginBottom: '8px' }}>
                                                                            {point}
                                                                        </li>
                                                                    ))
                                                                }
                                                            </ul>
                                                        ) : (
                                                            <p style={{ whiteSpace: 'pre-wrap' }}>{diffData.summary.summary}</p>
                                                        )}
                                                    </div>
                                                    {diffData.summary.aggregated && (
                                                        <div className="batch-info" style={{ 
                                                            marginTop: '12px', 
                                                            padding: '8px 12px', 
                                                            background: '#e3f2fd', 
                                                            borderRadius: '4px',
                                                            fontSize: '14px',
                                                            color: '#1976d2'
                                                        }}>
                                                            <strong>Batch Processing:</strong> {diffData.summary.successfulChunks}/{diffData.summary.totalChunks} chunks processed successfully
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* Handle old response structure */}
                                            {diffData.summary.output?.Summary && (
                                                <div className="summary-section">
                                                    <h6>Changes Made:</h6>
                                                    <ul>
                                                        {diffData.summary.output.Summary.split("\n").map((change, index) => (
                                                            <li key={index}>{change.replace(/^-\s*/, "")}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            {diffData.summary.files && (
                                                <div className="summary-section">
                                                    <h6>Files Modified:</h6>
                                                    <ul>
                                                        {Array.isArray(diffData.summary.files) ? 
                                                            diffData.summary.files.map((file, index) => (
                                                                <li key={index} className="file-item">
                                                                    <code>{file}</code>
                                                                </li>
                                                            )) :
                                                            <li><code>{diffData.summary.files}</code></li>
                                                        }
                                                    </ul>
                                                </div>
                                            )}
                                            {diffData.summary.impact && (
                                                <div className="summary-section">
                                                    <h6>Impact:</h6>
                                                    <p>{diffData.summary.impact}</p>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="summary-text">
                                            <p>{typeof diffData.summary === 'string' ? diffData.summary : (diffData.summary || 'No summary available')}</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="diff-actions">
                                <button 
                                    className="btn btn-outline"
                                    onClick={handleFetchDiff}
                                >
                                    Refresh Summary
                                </button>
                                <button 
                                    className="btn btn-secondary"
                                    onClick={handleDownloadDocx}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
                                    </svg>
                                    Download DOCX
                                </button>
                                <button 
                                    className="btn btn-success"
                                    onClick={handleGenerateJiraTickets}
                                    disabled={jiraLoading}
                                >
                                    {jiraLoading ? (
                                        <>
                                            <div className="loading-spinner" style={{ width: '16px', height: '16px', marginRight: '8px' }}></div>
                                            Creating Jira Tickets...
                                        </>
                                    ) : (
                                        <>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                                <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z"/>
                                            </svg>
                                            Generate Jira Tickets
                                        </>
                                    )}
                                </button>
                                <button 
                                    className="btn btn-primary"
                                    onClick={handleClose}
                                >
                                    Close
                                </button>
                            </div>

                            {/* Jira Results Section */}
                            {jiraResult && (
                                <div className="jira-results" style={{ 
                                    marginTop: '24px', 
                                    padding: '20px', 
                                    background: '#f8f9fa', 
                                    borderRadius: '8px',
                                    border: '1px solid #e9ecef'
                                }}>
                                    <h5 style={{ marginBottom: '16px', color: jiraResult.success ? '#28a745' : '#dc3545', display: 'flex', alignItems: 'center' }}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                            {jiraResult.success ? 
                                                <path d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"/> :
                                                <path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z"/>
                                            }
                                        </svg>
                                        {jiraResult.success ? 'Jira Tickets Created Successfully!' : 'Failed to Create Jira Tickets'}
                                    </h5>
                                    
                                    {jiraResult.success && (
                                        <div style={{ marginBottom: '16px' }}>
                                            <p style={{ marginBottom: '8px' }}>
                                                <strong>Status:</strong> {jiraResult.message}
                                            </p>
                                            <p style={{ marginBottom: '8px' }}>
                                                <strong>Total Tickets:</strong> {jiraResult.totalTickets} | 
                                                <strong> Successful:</strong> {jiraResult.successfulTickets} | 
                                                <strong> Failed:</strong> {jiraResult.failedTickets}
                                            </p>
                                            
                                            {jiraResult.tickets?.created && jiraResult.tickets.created.length > 0 && (
                                                <div style={{ marginBottom: '16px' }}>
                                                    <h6>Created Tickets:</h6>
                                                    <ul style={{ marginLeft: '20px' }}>
                                                        {jiraResult.tickets.created.map((ticket, index) => (
                                                            <li key={index} style={{ marginBottom: '4px' }}>
                                                                <strong>{ticket.key}:</strong> {ticket.title}
                                                                <br />
                                                                <a href={ticket.url} target="_blank" rel="noopener noreferrer" style={{ color: '#007bff', fontSize: '14px' }}>
                                                                    View in Jira →
                                                                </a>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                            
                                            {jiraResult.tickets?.failed && jiraResult.tickets.failed.length > 0 && (
                                                <div style={{ marginBottom: '16px' }}>
                                                    <h6>Failed Tickets:</h6>
                                                    <ul style={{ marginLeft: '20px' }}>
                                                        {jiraResult.tickets.failed.map((ticket, index) => (
                                                            <li key={index} style={{ color: '#dc3545' }}>
                                                                <strong>{ticket.title}:</strong> {ticket.error}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    
                                    {!jiraResult.success && (
                                        <div style={{ 
                                            padding: '12px', 
                                            background: '#f8d7da', 
                                            border: '1px solid #f5c6cb', 
                                            borderRadius: '6px',
                                            color: '#721c24'
                                        }}>
                                            <strong>Error:</strong> {jiraResult.error || jiraResult.message}
                                        </div>
                                    )}
                                    
                                    {jiraResult.success && (
                                        <div style={{ 
                                            padding: '12px', 
                                            background: '#d4edda', 
                                            border: '1px solid #c3e6cb', 
                                            borderRadius: '6px',
                                            color: '#155724'
                                        }}>
                                            <strong>Next Steps:</strong>
                                            <ul style={{ marginTop: '8px', marginBottom: '0', marginLeft: '10px' }}>
                                                <li>Check your Jira project for the newly created tickets</li>
                                                <li>Tickets are automatically labeled and categorized</li>
                                                <li>Review and assign tickets to team members as needed</li>
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}

                            {jiraError && (
                                <div className="jira-error" style={{ 
                                    marginTop: '24px', 
                                    padding: '20px', 
                                    background: '#f8d7da', 
                                    borderRadius: '8px',
                                    border: '1px solid #f5c6cb',
                                    color: '#721c24'
                                }}>
                                    <h5 style={{ marginBottom: '16px', color: '#dc3545', display: 'flex', alignItems: 'center' }}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                                            <path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z"/>
                                        </svg>
                                        Failed to Create Jira Tickets
                                    </h5>
                                    <p><strong>Error:</strong> {jiraError}</p>
                                    <button 
                                        className="btn btn-outline"
                                        onClick={handleGenerateJiraTickets}
                                        style={{ marginTop: '12px' }}
                                    >
                                        Try Again
                                    </button>
                                </div>
                            )}

                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DiffModal;

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Jira API Integration Service
 * Handles creating Jira tickets from git diff summaries
 */

// Jira configuration from environment variables
const JIRA_CONFIG = {
    baseUrl: process.env.JIRA_BASE_URL, // e.g., 'https://yourcompany.atlassian.net'
    username: process.env.JIRA_USERNAME, // Your Jira email
    apiToken: process.env.JIRA_API_TOKEN, // Jira API token
    projectKey: process.env.JIRA_PROJECT_KEY, // e.g., 'PROJ'
    issueType: process.env.JIRA_ISSUE_TYPE || 'Task', // Default issue type
};

/**
 * Create authentication header for Jira API
 */
function getAuthHeader() {
    if (!JIRA_CONFIG.username || !JIRA_CONFIG.apiToken) {
        throw new Error('Jira credentials not configured. Please set JIRA_USERNAME and JIRA_API_TOKEN environment variables.');
    }
    
    const auth = Buffer.from(`${JIRA_CONFIG.username}:${JIRA_CONFIG.apiToken}`).toString('base64');
    return `Basic ${auth}`;
}

/**
 * Validate Jira configuration
 */
function validateJiraConfig() {
    const required = ['baseUrl', 'username', 'apiToken', 'projectKey'];
    const missing = required.filter(key => !JIRA_CONFIG[key]);
    
    if (missing.length > 0) {
        throw new Error(`Missing Jira configuration: ${missing.join(', ')}. Please set the required environment variables.`);
    }
    
    // Validate URL format
    try {
        new URL(JIRA_CONFIG.baseUrl);
    } catch (error) {
        throw new Error('Invalid JIRA_BASE_URL format. Please provide a valid URL (e.g., https://yourcompany.atlassian.net)');
    }
}

/**
 * Parse git diff summary into structured ticket data
 */
function parseSummaryForTickets(summary) {
    if (!summary || typeof summary !== 'object') {
        return [{
            title: 'Code Changes Summary',
            description: summary || 'No summary available',
            priority: 'Medium'
        }];
    }

    const tickets = [];
    let summaryText = '';
    
    // Handle new batching response structure
    if (summary.summary) {
        summaryText = summary.summary;
    }
    // Handle old structured summary with output.Summary
    else if (summary.output?.Summary) {
        summaryText = summary.output.Summary;
    }
    
    if (summaryText) {
        // Handle multi-chunk summaries by combining all chunks
        const changes = summaryText
            .split('--- Chunk Summary ---')
            .flatMap(chunk => 
                chunk.trim()
                    .split('\n')
                    .filter(line => line.trim())
                    .map(line => line.replace(/^[-•]\s*/, '').trim())
                    .filter(line => line)
            );
        
        // Group changes by category
        const categories = {
            'New Features': [],
            'Bug Fixes': [],
            'Improvements': [],
            'Other Changes': []
        };
        
        changes.forEach(change => {
            const cleanChange = change.replace(/^-\s*/, '').trim();
            if (!cleanChange) return;
            
            // Categorize based on keywords
            const lowerChange = cleanChange.toLowerCase();
            if (lowerChange.includes('add') || lowerChange.includes('new') || lowerChange.includes('create')) {
                categories['New Features'].push(cleanChange);
            } else if (lowerChange.includes('fix') || lowerChange.includes('bug') || lowerChange.includes('error')) {
                categories['Bug Fixes'].push(cleanChange);
            } else if (lowerChange.includes('improve') || lowerChange.includes('optimize') || lowerChange.includes('enhance')) {
                categories['Improvements'].push(cleanChange);
            } else {
                categories['Other Changes'].push(cleanChange);
            }
        });
        
        // Create tickets for each category with changes
        Object.entries(categories).forEach(([category, changes]) => {
            if (changes.length > 0) {
                tickets.push({
                    title: `${category} - ${changes.length} item${changes.length > 1 ? 's' : ''}`,
                    description: `**${category}:**\n\n${changes.map(change => `• ${change}`).join('\n')}`,
                    priority: category === 'Bug Fixes' ? 'High' : category === 'New Features' ? 'Medium' : 'Low'
                });
            }
        });
    }
    
    // Handle files information
    if (summary.files && Array.isArray(summary.files) && summary.files.length > 0) {
        tickets.push({
            title: 'Files Modified',
            description: `**Files Changed:**\n\n${summary.files.map(file => `• ${file}`).join('\n')}`,
            priority: 'Low'
        });
    }
    
    // Handle impact information
    if (summary.impact) {
        tickets.push({
            title: 'Change Impact Analysis',
            description: `**Impact:**\n\n${summary.impact}`,
            priority: 'Medium'
        });
    }
    
    // If no structured data, create a general ticket
    if (tickets.length === 0) {
        tickets.push({
            title: 'Code Changes Summary',
            description: JSON.stringify(summary, null, 2),
            priority: 'Medium'
        });
    }
    
    return tickets;
}

/**
 * Create a Jira ticket
 */
async function createJiraTicket(ticketData, projectInfo = {}) {
    validateJiraConfig();
    
    const authHeader = getAuthHeader();
    const url = `${JIRA_CONFIG.baseUrl}/rest/api/3/issue`;
    
    // Prepare ticket payload
    const payload = {
        fields: {
            project: {
                key: JIRA_CONFIG.projectKey
            },
            summary: ticketData.title,
            issuetype: {
                name: JIRA_CONFIG.issueType
            },
            description: {
                type: 'doc',
                version: 1,
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: ticketData.description
                            }
                        ]
                    }
                ]
            },
            priority: {
                name: ticketData.priority
            },
            labels: [
                'auto-generated',
                'git-diff',
                projectInfo.name ? `project-${projectInfo.name.toLowerCase()}` : 'code-changes'
            ]
        }
    };
    
    // Add project information if available
    if (projectInfo.name) {
        payload.fields.description.content.push({
            type: 'paragraph',
            content: [
                {
                    type: 'text',
                    text: `\n\n**Project:** ${projectInfo.name}`
                }
            ]
        });
    }
    
    if (projectInfo.repository) {
        payload.fields.description.content.push({
            type: 'paragraph',
            content: [
                {
                    type: 'text',
                    text: `**Repository:** ${projectInfo.repository}`
                }
            ]
        });
    }
    
    if (projectInfo.commitHash) {
        payload.fields.description.content.push({
            type: 'paragraph',
            content: [
                {
                    type: 'text',
                    text: `**Commit:** ${projectInfo.commitHash}`
                }
            ]
        });
    }
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Jira API error: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        return {
            success: true,
            ticketId: result.id,
            ticketKey: result.key,
            ticketUrl: `${JIRA_CONFIG.baseUrl}/browse/${result.key}`,
            title: ticketData.title
        };
    } catch (error) {
        console.error('Error creating Jira ticket:', error);
        return {
            success: false,
            error: error.message,
            title: ticketData.title
        };
    }
}

/**
 * Create multiple Jira tickets from git diff summary
 */
export async function createJiraTicketsFromSummary(summary, projectInfo = {}) {
    try {
        validateJiraConfig();
        
        const tickets = parseSummaryForTickets(summary);
        const results = [];
        
        console.log(`Creating ${tickets.length} Jira tickets...`);
        
        // Create tickets sequentially to avoid rate limiting
        for (const ticket of tickets) {
            const result = await createJiraTicket(ticket, projectInfo);
            results.push(result);
            
            // Small delay between requests to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        return {
            success: successful.length > 0,
            totalTickets: tickets.length,
            successfulTickets: successful.length,
            failedTickets: failed.length,
            results: results,
            summary: {
                created: successful.map(r => ({
                    key: r.ticketKey,
                    title: r.title,
                    url: r.ticketUrl
                })),
                failed: failed.map(r => ({
                    title: r.title,
                    error: r.error
                }))
            }
        };
    } catch (error) {
        console.error('Error creating Jira tickets:', error);
        return {
            success: false,
            error: error.message,
            totalTickets: 0,
            successfulTickets: 0,
            failedTickets: 0,
            results: []
        };
    }
}

/**
 * Test Jira connection
 */
export async function testJiraConnection() {
    try {
        validateJiraConfig();
        
        const authHeader = getAuthHeader();
        const url = `${JIRA_CONFIG.baseUrl}/rest/api/3/myself`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Jira connection failed: ${response.status} - ${errorText}`);
        }
        
        const userInfo = await response.json();
        return {
            success: true,
            user: userInfo.displayName,
            email: userInfo.emailAddress,
            accountId: userInfo.accountId
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get Jira project information
 */
export async function getJiraProjectInfo() {
    try {
        validateJiraConfig();
        
        const authHeader = getAuthHeader();
        const url = `${JIRA_CONFIG.baseUrl}/rest/api/3/project/${JIRA_CONFIG.projectKey}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get project info: ${response.status} - ${errorText}`);
        }
        
        const projectInfo = await response.json();
        return {
            success: true,
            project: {
                key: projectInfo.key,
                name: projectInfo.name,
                description: projectInfo.description,
                lead: projectInfo.lead?.displayName
            }
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

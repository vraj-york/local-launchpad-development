import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
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
    console.log('Creating Jira ticket with payload:', JSON.stringify(payload, null, 2));

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
 * Build Jira ADF description content: description paragraph + optional metadata section.
 * @param {string} description - Main description text
 * @param {Object|null} metadata - Optional metadata object (e.g. browser, pageUrl, screenResolution)
 * @returns {Array} ADF content array
 */
function buildDescriptionContent(description, metadata) {
    const content = [
        {
            type: 'paragraph',
            content: [{ type: 'text', text: description || '' }]
        }
    ];
    if (metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0) {
        const skipKeys = ['raw'];
        const labels = {
            browser: 'Browser',
            userAgent: 'User agent',
            screenResolution: 'Screen resolution',
            viewportSize: 'Viewport size',
            devicePixelRatio: 'Device pixel ratio',
            pageUrl: 'Page URL',
            pageTitle: 'Page title',
            timestamp: 'Timestamp',
            language: 'Language',
            platform: 'Platform',
            cookiesEnabled: 'Cookies enabled',
            onlineStatus: 'Online status'
        };
        const items = [];
        for (const [key, value] of Object.entries(metadata)) {
            if (skipKeys.includes(key) || value === undefined || value === null) continue;
            const label = labels[key] || key;
            const text = typeof value === 'boolean' ? `${label}: ${value}` : `${label}: ${String(value)}`;
            if (text.length > 500) items.push({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${label}: ${String(value).slice(0, 497)}…` }] }] });
            else items.push({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
        }
        if (items.length > 0) {
            content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Metadata', marks: [{ type: 'strong' }] }] });
            content.push({ type: 'bulletList', content: items });
        }
    }
    return content;
}

/**
 * Create a single Jira ticket using project-specific config (e.g. from DB).
 * Used by feedback flow: one ticket per submission with description and optional metadata.
 * @param {Object} ticketData - { title, description, metadata? }
 * @param {Object} config - { baseUrl, projectKey, apiToken, email, issueType? }
 * @returns {Promise<{ success: boolean, ticketKey?: string, ticketUrl?: string, error?: string }>}
 */
export async function createJiraTicketWithConfig(ticketData, config) {
    const { baseUrl, projectKey, apiToken, email, issueType = 'Task' } = config;
    console.log('[jira] createJiraTicketWithConfig called | baseUrl:', baseUrl, '| projectKey:', projectKey, '| issueType:', issueType);
    if (!baseUrl || !projectKey || !apiToken || !email) {
        const missing = []; if (!baseUrl) missing.push('baseUrl'); if (!projectKey) missing.push('projectKey'); if (!apiToken) missing.push('apiToken'); if (!email) missing.push('email');
        console.warn('[jira] createJiraTicketWithConfig validation failed — missing:', missing.join(', '));
        return { success: false, error: 'Missing Jira configuration (baseUrl, projectKey, apiToken, email)' };
    }
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue`;
    const descriptionContent = buildDescriptionContent(ticketData.description, ticketData.metadata || null);
    const payload = {
        fields: {
            project: { key: projectKey },
            summary: ticketData.title || 'Feedback from widget',
            issuetype: { name: issueType || 'Task' },
            description: {
                type: 'doc',
                version: 1,
                content: descriptionContent
            }
        }
    };
    try {
        console.log('[jira] POST', url, '| summary:', (ticketData.title || '').slice(0, 60) + (ticketData.title?.length > 60 ? '...' : ''));
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${auth}`,
                Accept: 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const text = await response.text();
            console.error('[jira] createJiraTicketWithConfig API error:', response.status, text.slice(0, 200));
            return { success: false, error: `Jira API ${response.status}: ${text}` };
        }
        const result = await response.json();
        const ticketKey = result.key;
        const ticketUrl = `${baseUrl.replace(/\/$/, '')}/browse/${ticketKey}`;
        console.log('[jira] Ticket created successfully:', ticketKey, '| url:', ticketUrl);
        return { success: true, ticketKey, ticketUrl };
    } catch (err) {
        console.error('[jira] createJiraTicketWithConfig exception:', err.message, err.stack);
        return { success: false, error: err.message };
    }
}

/**
 * Attach a file to an existing Jira issue using the Jira Cloud REST API.
 * @param {string} issueKey - e.g. PROJ-123
 * @param {string} filePath - absolute path to the file
 * @param {Object} config - { baseUrl, apiToken, email }
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function addAttachmentToJiraIssue(issueKey, filePath, config) {
    const { baseUrl, apiToken, email } = config;
    console.log('[jira] addAttachmentToJiraIssue called | issueKey:', issueKey, '| filePath:', filePath, '| baseUrl:', baseUrl);
    if (!baseUrl || !apiToken || !email) {
        console.warn('[jira] addAttachmentToJiraIssue — missing config (baseUrl/apiToken/email)');
        return { success: false, error: 'Missing Jira config for attachment' };
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        console.error('[jira] addAttachmentToJiraIssue — file not found:', filePath);
        return { success: false, error: 'File not found: ' + filePath };
    }
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`;
    const filename = path.basename(filePath);
    const mimeType = filename.toLowerCase().endsWith('.png') ? 'image/png' : (filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png');
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), { filename, contentType: mimeType });
    try {
        console.log('[jira] POST attachment to', url, '| filename:', filename, '| mimeType:', mimeType);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${auth}`,
                'X-Atlassian-Token': 'no-check',
                ...form.getHeaders()
            },
            body: form
        });
        if (!response.ok) {
            const text = await response.text();
            console.error('[jira] addAttachmentToJiraIssue API error:', response.status, text.slice(0, 200));
            return { success: false, error: `Jira attachment API ${response.status}: ${text}` };
        }
        console.log('[jira] Attachment added successfully to', issueKey);
        return { success: true };
    } catch (err) {
        console.error('[jira] addAttachmentToJiraIssue exception:', err.message, err.stack);
        return { success: false, error: err.message };
    }
}

/**
 * Fetch Jira tickets for a project using dynamic configuration
 */
// jira.service.js
export async function fetchProjectJiraTickets(config) {
    try {
        const { baseUrl, email, apiToken, projectKey } = config;

        if (!baseUrl || !email || !apiToken || !projectKey) {
            throw new Error("Missing Jira configuration");
        }

        const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");

        const response = await fetch(
            `${baseUrl}/rest/api/3/search/jql`,
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${auth}`,
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    jql: `project = ${projectKey} ORDER BY updated DESC`,
                    maxResults: 50,
                    fields: [
                        "summary",
                        "status",
                        "priority",
                        "issuetype",
                        "created",
                        "updated"
                    ]
                })
            }
        );

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`${response.status} - ${text}`);
        }

        const data = await response.json();

        return {
            success: true,
            total: data.total,
            issues: data.issues.map(issue => ({
                id: issue.id,
                key: issue.key,
                url: `${baseUrl}/browse/${issue.key}`,
                summary: issue.fields.summary,
                status: issue.fields.status.name,
                priority: issue.fields.priority?.name ?? null,
                type: issue.fields.issuetype.name,
                icon: issue.fields.issuetype.iconUrl,
                created: issue.fields.created,
                updated: issue.fields.updated
            }))
        };
    } catch (error) {
        console.error("fetchProjectJiraTickets error:", error);
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

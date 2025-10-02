# Jira Integration Setup Guide

This guide explains how to set up Jira integration for automatic ticket generation from git diff summaries.

## Overview

The system can automatically create Jira tickets based on git diff summaries. It analyzes code changes and creates categorized tickets for:
- New Features
- Bug Fixes  
- Improvements
- Other Changes
- Files Modified
- Change Impact Analysis

## Prerequisites

1. **Jira Cloud or Server Instance**: You need access to a Jira instance
2. **Admin Access**: You need admin permissions to create API tokens and configure projects
3. **Project Access**: You need access to the Jira project where tickets will be created

## Step 1: Create Jira API Token

1. **Log into your Jira instance**
2. **Go to Account Settings**:
   - Click on your profile picture/avatar in the top right
   - Select "Account settings" or "Personal settings"
3. **Navigate to Security**:
   - Look for "Security" or "API tokens" section
4. **Create API Token**:
   - Click "Create API token"
   - Give it a descriptive name like "Zip-Sync Integration"
   - Copy the generated token (you won't be able to see it again)

## Step 2: Get Your Jira Information

### Base URL
- For Jira Cloud: `https://yourcompany.atlassian.net`
- For Jira Server: `https://your-jira-server.com`

### Username/Email
- Use your Jira login email address

### Project Key
- Go to your Jira project
- The project key is usually visible in the URL or project settings
- Example: If your project URL is `https://company.atlassian.net/browse/PROJ-123`, then `PROJ` is your project key

## Step 3: Configure Environment Variables

Add the following environment variables to your backend `.env` file:

```env
# Jira Configuration
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_USERNAME=your-email@company.com
JIRA_API_TOKEN=your-api-token-here
JIRA_PROJECT_KEY=PROJ
JIRA_ISSUE_TYPE=Task
```

### Environment Variables Explained

| Variable | Description | Example |
|----------|-------------|---------|
| `JIRA_BASE_URL` | Your Jira instance URL | `https://company.atlassian.net` |
| `JIRA_USERNAME` | Your Jira email address | `john.doe@company.com` |
| `JIRA_API_TOKEN` | API token from Step 1 | `ATATT3xFfGF0...` |
| `JIRA_PROJECT_KEY` | Target project key | `PROJ` |
| `JIRA_ISSUE_TYPE` | Type of issues to create | `Task` (optional, defaults to "Task") |

## Step 4: Test the Connection

1. **Start your backend server**
2. **Test the connection** using the API endpoint:
   ```bash
   curl -X GET "http://localhost:5000/api/projects/jira/test-connection" \
        -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

3. **Expected Response**:
   ```json
   {
     "connection": {
       "success": true,
       "user": "John Doe",
       "email": "john.doe@company.com",
       "accountId": "5f8b8b8b8b8b8b8b8b8b8b8b"
     },
     "project": {
       "success": true,
       "project": {
         "key": "PROJ",
         "name": "My Project",
         "description": "Project description",
         "lead": "John Doe"
       }
     },
     "config": {
       "baseUrl": "Set",
       "username": "Set", 
       "apiToken": "Set",
       "projectKey": "Set"
     }
   }
   ```

## Step 5: Generate Jira Tickets

Once configured, you can generate Jira tickets:

1. **Open a project** in the frontend
2. **Click "View Changes"** to see the git diff summary
3. **Click "Generate Jira Tickets"** button
4. **Review the results** showing created tickets with links

## How It Works

### Ticket Creation Process

1. **Git Diff Analysis**: The system gets the latest git diff
2. **Summary Generation**: Uses AI to generate a structured summary
3. **Ticket Parsing**: Categorizes changes into different ticket types
4. **Jira API Calls**: Creates tickets via Jira REST API
5. **Results Display**: Shows created tickets with direct links

### Ticket Categories

The system automatically creates tickets for:

- **New Features**: Changes that add new functionality
- **Bug Fixes**: Changes that fix issues or errors  
- **Improvements**: Changes that enhance existing features
- **Other Changes**: Miscellaneous changes
- **Files Modified**: List of changed files
- **Change Impact**: Analysis of the overall impact

### Ticket Structure

Each ticket includes:
- **Title**: Descriptive title based on the change category
- **Description**: Detailed description with bullet points
- **Labels**: Auto-generated labels (`auto-generated`, `git-diff`, `project-{name}`)
- **Priority**: Based on change type (High for bug fixes, Medium for features, etc.)
- **Project Info**: Links to repository and commit information

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Check your API token is correct
   - Verify your email address
   - Ensure the token hasn't expired

2. **Project Not Found**
   - Verify the project key is correct
   - Check you have access to the project
   - Ensure the project exists

3. **Permission Denied**
   - Verify you have permission to create issues in the project
   - Check if the issue type exists in the project
   - Ensure you're not restricted by project permissions

4. **Rate Limiting**
   - The system includes delays between API calls
   - If you hit rate limits, wait a few minutes and try again

### Testing Connection

Use the test endpoint to verify your setup:

```bash
# Test Jira connection
curl -X GET "http://localhost:5000/api/projects/jira/test-connection" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Content-Type: application/json"
```

### Debug Mode

Check the backend logs for detailed error messages:

```bash
# View backend logs
tail -f backend/logs/app.log
```

## Security Considerations

1. **API Token Security**:
   - Store API tokens securely
   - Don't commit tokens to version control
   - Rotate tokens regularly

2. **Access Control**:
   - Only admin users can test Jira connections
   - Project managers can generate tickets for their projects
   - Regular users cannot access Jira functionality

3. **Rate Limiting**:
   - Built-in delays prevent API abuse
   - Respects Jira's rate limits
   - Handles errors gracefully

## Advanced Configuration

### Custom Issue Types

You can configure different issue types by setting the `JIRA_ISSUE_TYPE` environment variable:

```env
JIRA_ISSUE_TYPE=Story    # For user stories
JIRA_ISSUE_TYPE=Bug      # For bug reports  
JIRA_ISSUE_TYPE=Task     # For general tasks
```

### Custom Labels

The system automatically adds labels to tickets:
- `auto-generated`: Identifies automatically created tickets
- `git-diff`: Indicates tickets created from git diffs
- `project-{name}`: Links tickets to specific projects

### Priority Mapping

Priorities are automatically assigned based on change type:
- **High**: Bug fixes and critical issues
- **Medium**: New features and improvements
- **Low**: File modifications and minor changes

## Support

If you encounter issues:

1. **Check the logs** for detailed error messages
2. **Verify your configuration** using the test endpoint
3. **Ensure proper permissions** in Jira
4. **Contact your Jira administrator** for access issues

## Example Workflow

1. **Developer pushes code** to the repository
2. **Project manager uploads** the new version via the system
3. **System generates** git diff and summary
4. **Manager clicks** "Generate Jira Tickets"
5. **System creates** categorized tickets in Jira
6. **Team receives** notifications and can start working on tickets

This integration streamlines the process of converting code changes into actionable Jira tickets, improving project management and team coordination.

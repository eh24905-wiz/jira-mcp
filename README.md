# Jira MCP Server

A Model Context Protocol (MCP) server for Jira integration, enabling AI assistants to interact with Jira issues, comments, and custom fields through a standardized interface.

## Features

This MCP server provides the following tools:

| Tool | Description |
|------|-------------|
| `get_my_issues` | Get all issues currently assigned to you |
| `get_issue_details` | Get full details of a specific Jira issue |
| `add_comment` | Add a comment to a specified Jira issue |
| `get_my_work_summary` | Get a summary of issues you've worked on within a date range |
| `get_team_activity` | Get recent issue updates from configured team members |
| `get_project_components` | Get all available components for a Jira project |
| `update_issue_field` | Update supported custom fields on a Jira issue |
| `update_progress` | Update the Progress Update field with template-aware behavior |
| `create_issue` | Create a new issue in Jira with support for custom fields |
| `get_sprint_tasks` | Retrieve sprint tasks for the current week or next week |

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher
- **Jira Cloud Account**: With API access enabled
- **Jira API Token**: Generated from your Atlassian account

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd jira-mcp
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

## Configuration

### Environment Variables

The server requires the following environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `JIRA_BASE_URL` | Your Jira instance base URL | `https://your-org.atlassian.net` |
| `JIRA_USER_EMAIL` | Your Jira account email | `user@example.com` |
| `JIRA_API_TOKEN` | Jira API token ([Generate here](https://id.atlassian.com/manage-profile/security/api-tokens)) | `ATATT3xFfGF0...` |
| `JIRA_CURRENT_USER` | (Optional) Override current user for queries | `currentuser()` |
| `JIRA_TEAM_MEMBERS` | (Optional) Comma-separated list of team member emails | `user1@example.com,user2@example.com` |

## Usage

### Starting the Server

```bash
# Production
npm start

# Development (with hot reload)
npm run dev
```

### MCP Client Configuration

Add the server to your MCP client configuration:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/jira-mcp/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-org.atlassian.net",
        "JIRA_USER_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_TEAM_MEMBERS": "teammate1@example.com,teammate2@example.com"
      }
    }
  }
}
```

## Supported Custom Fields

The following custom fields can be updated using `update_issue_field`:

| Field Name | Field ID | Type | Description |
|------------|----------|------|-------------|
| Decision Needed | `customfield_15111` | Rich text (ADF) | Flag if a decision is required |
| Progress Update | `customfield_15112` | Rich text (ADF) | Weekly progress status |
| Decision Maker(s) | `customfield_15113` | User picker | Person responsible for decisions |
| Risks/Blockers | `customfield_15115` | Rich text (ADF) | Current risks or blockers |
| Completion Percentage | `customfield_15116` | Number | Progress percentage (0-100) |
| Health Status | `customfield_15117` | Select | Project health (On Track, At Risk, etc.) |

## API Reference

### get_my_issues

Returns all unresolved issues assigned to the current user.

**Parameters:** None

**Returns:** Array of issues with `key`, `summary`, `status`, `priority`, `updated`

---

### get_issue_details

Get full details of a specific issue.

**Parameters:**
- `issueKey` (string, required): The issue key (e.g., "PROJ-123")

**Returns:** Issue object with `key`, `summary`, `description`, `status`, `priority`, `assignee`, `reporter`, `created`, `updated`, `comments`

---

### add_comment

Add a comment to an issue.

**Parameters:**
- `issueKey` (string, required): The issue key
- `commentBody` (string, required): The comment text

**Returns:** `{ success: boolean, commentId: string, created: string }`

---

### get_my_work_summary

Get issues you've worked on within a date range.

**Parameters:**
- `startDate` (string, required): Start date in YYYY-MM-DD format
- `endDate` (string, required): End date in YYYY-MM-DD format

**Returns:** Array of issues with activity type

---

### get_team_activity

Get recent updates from team members.

**Parameters:**
- `timeframeDays` (number, optional): Days to look back (default: 7)

**Returns:** Array of activity items with `issueKey`, `teamMember`, `activityType`, `timestamp`, `summary`

---

### update_issue_field

Update a custom field on an issue.

**Parameters:**
- `issueKey` (string, required): The issue key
- `fieldNameOrId` (string, required): Field name or ID
- `value` (string | number | object, required): Value to set

**Returns:** `{ success: boolean, fieldId: string, fieldName: string }`

---

### update_progress

Update the Progress Update field with template awareness.

**Parameters:**
- `issueKey` (string, required): The issue key
- `refreshDate` (boolean, optional): Update date only, preserve content
- `weeklyUpdate` (string, optional): Weekly update text
- `delivered` (string, optional): What was delivered
- `whatsNext` (string, optional): Upcoming work

**Returns:** `{ success: boolean, updatedSections: string[], parsedExisting: object }`

The Progress Update field uses a structured template:
- ℹ️ **Update for week of [date]:** - Weekly status
- ✅ **What we've delivered so far:** - Accomplishments
- ❓ **What's next:** - Upcoming work

---

### get_project_components

Get all available components for a Jira project.

**Parameters:**
- `projectKey` (string, required): The project key (e.g., "TSSE")

**Returns:** `{ components: [{ id: string, name: string, description?: string }] }`

---

### create_issue

Create a new issue in Jira with support for standard and custom fields.

**Parameters:**
- `projectKey` (string, required): The project key (e.g., "TSSE")
- `issueType` (string, required): The issue type (e.g., "Epic", "Story", "Task", "Bug")
- `summary` (string, required): Issue summary/title
- `description` (string, optional): Issue description (plain text)
- `assignee` (string, optional): Assignee accountId or "currentuser()" for current user
- `priority` (string, optional): Priority name (e.g., "High", "Medium", "Low")
- `labels` (string[], optional): Array of labels to apply
- `duedate` (string, optional): Due date in YYYY-MM-DD format
- `components` (string[], optional): Array of component names
- `healthStatus` (string, optional): Health Status value (e.g., "On Track", "At Risk", "Off Track")
- `completionPercentage` (number, optional): Completion percentage (0-100)
- `decisionNeeded` (string, optional): Decision Needed field content
- `risksBlockers` (string, optional): Risks/Blockers field content
- `progressUpdate` (object, optional): Progress Update with `weeklyUpdate`, `delivered`, `whatsNext`
- `customFields` (object, optional): Additional custom fields as key-value pairs

**Returns:** `{ success: boolean, key: string, id: string, self: string }`

---

### get_sprint_tasks

Retrieve sprint tasks for the current week or next week. Sprint tasks are tagged with labels in the format MonDD-DD (e.g., Dec15-19 for December 15-19).

**Parameters:**
- `week` (enum, required): Which week to retrieve - `"this_week"` or `"next_week"`
- `scope` (enum, required): Scope of tasks - `"my_tasks"` for current user only, `"team_tasks"` for all team tasks

**Returns:**
```json
{
  "sprintLabel": "Dec15-19",
  "weekRange": { "monday": "2024-12-15", "friday": "2024-12-19" },
  "tasks": [{ "key": "PROJ-123", "summary": "...", "status": "...", "priority": "...", "assignee": "...", "updated": "..." }]
}
```

## Development

### Building

```bash
npm run build
```

### Project Structure

```
jira-mcp/
├── src/
│   ├── index.ts        # MCP server entry point and tool definitions
│   └── jira-client.ts  # Jira API client wrapper
├── dist/               # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── README.md
```

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


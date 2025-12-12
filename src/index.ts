#!/usr/bin/env node
/**
 * Jira MCP Server
 * A Model Context Protocol server for Jira integration using stdio transport
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import {
  searchIssues,
  getIssueDetails,
  addComment,
  getWorkSummary,
  getTeamActivity,
  updateIssueField,
  updateProgressField,
  CUSTOM_FIELD_MAP,
  JiraApiError,
} from './jira-client.js';

// ============ Configurable Constants ============
// These should be customized for your specific user/team

/** Jira username or accountId for "my" queries */
const CURRENT_USER: string = 'currentuser()';

/** Array of team member usernames or accountIds */
const TEAM_MEMBERS: string[] = [
  'joey.mcdonald@wiz.io',
  'hossein.panahi@wiz.io',
];

// ============ Server Setup ============

const server = new McpServer({
  name: 'jira-mcp-server',
  version: '1.0.0',
});

// ============ Helper Functions ============

/**
 * Formats a Jira API error for structured response
 */
function formatError(error: unknown): { error: { message: string; statusCode?: number; details?: unknown } } {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const apiError = error as JiraApiError;
    return {
      error: {
        message: apiError.message,
        statusCode: apiError.statusCode,
        details: apiError.errors,
      },
    };
  }
  return {
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

// ============ MCP Tool Handlers ============

/**
 * Tool: get_my_issues
 * Get all issues currently assigned to the configured CURRENT_USER
 */
server.registerTool(
  'get_my_issues',
  {
    title: 'Get My Issues',
    description: 'Get all issues currently assigned to the configured CURRENT_USER',
    inputSchema: {},
    outputSchema: {
      issues: z.array(z.object({
        key: z.string(),
        summary: z.string(),
        status: z.string(),
        priority: z.string(),
        updated: z.string(),
      })).optional(),
      error: z.object({
        message: z.string(),
        statusCode: z.number().optional(),
        details: z.unknown().optional(),
      }).optional(),
    },
  },
  async () => {
    try {
      const jql = `assignee = ${CURRENT_USER} AND resolution = Unresolved ORDER BY updated DESC`;
      const issues = await searchIssues(jql);
      const output = { issues };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    } catch (error) {
      const output = formatError(error);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
        isError: true,
      };
    }
  }
);

/**
 * Tool: add_comment
 * Add a comment to a specified Jira issue
 */
server.registerTool(
  'add_comment',
  {
    title: 'Add Comment',
    description: 'Add a comment to a specified Jira issue',
    inputSchema: {
      issueKey: z.string().describe('The issue key (e.g., "PROJ-123")'),
      commentBody: z.string().describe('The comment text to add'),
    },
    outputSchema: {
      success: z.boolean(),
      commentId: z.string().optional(),
      created: z.string().optional(),
      error: z.object({
        message: z.string(),
        statusCode: z.number().optional(),
        details: z.unknown().optional(),
      }).optional(),
    },
  },
  async ({ issueKey, commentBody }) => {
    try {
      if (!issueKey || !issueKey.trim()) {
        throw new Error('issueKey is required');
      }
      if (!commentBody || !commentBody.trim()) {
        throw new Error('commentBody is required');
      }

      const result = await addComment(issueKey, commentBody);
      const output = {
        success: true,
        commentId: result.id,
        created: result.created,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    } catch (error) {
      const output = { success: false, ...formatError(error) };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
        isError: true,
      };
    }
  }
);

/**
 * Tool: get_my_work_summary
 * Get a summary of issues the CURRENT_USER has worked on within a date range
 */
server.registerTool(
  'get_my_work_summary',
  {
    title: 'Get My Work Summary',
    description: 'Get a summary of issues the CURRENT_USER has worked on (updated, commented, or transitioned) within a date range',
    inputSchema: {
      startDate: z.string().describe('Start date in YYYY-MM-DD format'),
      endDate: z.string().describe('End date in YYYY-MM-DD format'),
    },
    outputSchema: {
      issues: z.array(z.object({
        key: z.string(),
        summary: z.string(),
        status: z.string(),
        lastActivityType: z.string(),
      })).optional(),
      error: z.object({
        message: z.string(),
        statusCode: z.number().optional(),
        details: z.unknown().optional(),
      }).optional(),
    },
  },
  async ({ startDate, endDate }) => {
    try {
      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate)) {
        throw new Error('startDate must be in YYYY-MM-DD format');
      }
      if (!dateRegex.test(endDate)) {
        throw new Error('endDate must be in YYYY-MM-DD format');
      }

      const issues = await getWorkSummary(CURRENT_USER, startDate, endDate);
      const output = { issues };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    } catch (error) {
      const output = formatError(error);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
        isError: true,
      };
    }
  }
);

/**
 * Tool: get_team_activity
 * Get recent issue updates from TEAM_MEMBERS
 */
server.registerTool(
  'get_team_activity',
  {
    title: 'Get Team Activity',
    description: 'Get recent issue updates (status changes, comments, assignments) from TEAM_MEMBERS',
    inputSchema: {
      timeframeDays: z.number().optional().describe('Number of days to look back (default: 7)'),
    },
    outputSchema: {
      activities: z.array(z.object({
        issueKey: z.string(),
        teamMember: z.string(),
        activityType: z.string(),
        timestamp: z.string(),
        summary: z.string().optional(),
      })).optional(),
      error: z.object({
        message: z.string(),
        statusCode: z.number().optional(),
        details: z.unknown().optional(),
      }).optional(),
    },
  },
  async ({ timeframeDays }) => {
    try {
      if (TEAM_MEMBERS.length === 0) {
        throw new Error('TEAM_MEMBERS is not configured. Please add team member usernames or accountIds.');
      }

      const days = timeframeDays ?? 7;
      if (days < 1 || days > 365) {
        throw new Error('timeframeDays must be between 1 and 365');
      }

      const activities = await getTeamActivity(TEAM_MEMBERS, days);
      const output = { activities };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    } catch (error) {
      const output = formatError(error);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
        isError: true,
      };
    }
  }
);

/**
 * Tool: get_issue_details
 * Get full details of a specific Jira issue
 */
server.registerTool(
  'get_issue_details',
  {
    title: 'Get Issue Details',
    description: 'Get full details of a specific Jira issue',
    inputSchema: {
      issueKey: z.string().describe('The issue key (e.g., "PROJ-123")'),
    },
    outputSchema: {
      key: z.string().optional(),
      summary: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      assignee: z.string().optional(),
      reporter: z.string().optional(),
      created: z.string().optional(),
      updated: z.string().optional(),
      comments: z.array(z.object({
        id: z.string(),
        author: z.string(),
        body: z.string(),
        created: z.string(),
        updated: z.string(),
      })).optional(),
      error: z.object({
        message: z.string(),
        statusCode: z.number().optional(),
        details: z.unknown().optional(),
      }).optional(),
    },
  },
  async ({ issueKey }) => {
    try {
      if (!issueKey || !issueKey.trim()) {
        throw new Error('issueKey is required');
      }

      const issue = await getIssueDetails(issueKey);
      const output = { ...issue };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    } catch (error) {
      const errOutput = formatError(error);
      return {
        content: [{ type: 'text', text: JSON.stringify(errOutput, null, 2) }],
        structuredContent: errOutput,
        isError: true,
      };
    }
  }
);

/**
 * Tool: update_issue_field
 * Update a custom field on a Jira issue
 */
server.registerTool(
  'update_issue_field',
  {
    title: 'Update Issue Field',
    description: `Update a custom field on a Jira issue. Supported fields: ${Object.values(CUSTOM_FIELD_MAP).join(', ')}. You can use either the field name or field ID.`,
    inputSchema: {
      issueKey: z.string().describe('The issue key (e.g., "TSSE-984")'),
      fieldNameOrId: z.string().describe(`Field name or ID. Valid names: ${Object.values(CUSTOM_FIELD_MAP).join(', ')}`),
      value: z.union([z.string(), z.number(), z.object({})]).describe('The value to set. For rich text fields, provide plain text. For select fields, provide the option value. For user fields, provide accountId. For number fields, provide a number.'),
    },
    outputSchema: {
      success: z.boolean(),
      fieldId: z.string().optional(),
      fieldName: z.string().optional(),
      error: z.object({
        message: z.string(),
        statusCode: z.number().optional(),
        details: z.unknown().optional(),
      }).optional(),
    },
  },
  async ({ issueKey, fieldNameOrId, value }) => {
    try {
      if (!issueKey || !issueKey.trim()) {
        throw new Error('issueKey is required');
      }
      if (!fieldNameOrId || !fieldNameOrId.trim()) {
        throw new Error('fieldNameOrId is required');
      }
      if (value === undefined || value === null) {
        throw new Error('value is required');
      }

      const result = await updateIssueField(issueKey, fieldNameOrId, value);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error) {
      const output = { success: false, ...formatError(error) };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
        isError: true,
      };
    }
  }
);

/**
 * Tool: update_progress
 * Update the Progress Update field with template-aware behavior
 */
server.registerTool(
  'update_progress',
  {
    title: 'Update Progress',
    description: `Update the Progress Update field (customfield_15112) on a Jira issue. This field uses a structured template with three sections:
- Weekly Update: "ℹ️ Update for week of [date]:" - automatically includes current date
- Delivered: "✅ What we've delivered so far:"
- What's Next: "❓ What's next:"

Options:
- Use refreshDate=true to update just the date while preserving all existing content
- Only sections you explicitly provide will be updated; others are preserved from existing content`,
    inputSchema: {
      issueKey: z.string().describe('The issue key (e.g., "TSSE-984")'),
      refreshDate: z.boolean().optional().describe('If true, updates the date to today while preserving all existing content. Use this to "refresh" the progress update without changing the content.'),
      weeklyUpdate: z.string().optional().describe('Text to add after the weekly header. Current date will be auto-inserted.'),
      delivered: z.string().optional().describe('Text describing what was delivered'),
      whatsNext: z.string().optional().describe('Text describing upcoming work'),
    },
    outputSchema: {
      success: z.boolean(),
      updatedSections: z.array(z.string()).optional(),
      parsedExisting: z.object({
        weeklyUpdate: z.string(),
        delivered: z.string(),
        whatsNext: z.string(),
      }).optional(),
      error: z.object({
        message: z.string(),
        statusCode: z.number().optional(),
        details: z.unknown().optional(),
      }).optional(),
    },
  },
  async ({ issueKey, refreshDate, weeklyUpdate, delivered, whatsNext }) => {
    try {
      if (!issueKey || !issueKey.trim()) {
        throw new Error('issueKey is required');
      }
      if (!refreshDate && weeklyUpdate === undefined && delivered === undefined && whatsNext === undefined) {
        throw new Error('At least one of refreshDate, weeklyUpdate, delivered, or whatsNext must be provided');
      }

      const result = await updateProgressField(issueKey, {
        refreshDate,
        weeklyUpdate,
        delivered,
        whatsNext,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error) {
      const output = { success: false, ...formatError(error) };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
        isError: true,
      };
    }
  }
);

// ============ Server Startup ============

/**
 * Main entry point - starts the MCP server with stdio transport
 */
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup to stderr (stdout is used for MCP communication)
  console.error('Jira MCP Server started successfully');
  console.error('Using stdio transport for communication');
}

main().catch((error) => {
  console.error('Failed to start Jira MCP Server:', error);
  process.exit(1);
});

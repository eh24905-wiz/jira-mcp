/**
 * Jira API Client Wrapper
 * Provides typed methods for interacting with Jira REST API v3
 */

// ============ Configuration ============

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_USER_EMAIL = process.env.JIRA_USER_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// Cache for current user's accountId
let currentUserAccountId: string | null = null;

// ============ Types ============

export interface JiraIssueParent {
  key: string;
  summary: string;
  status: string;
  priority: string;
  issueType: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  updated: string;
  description?: string;
  assignee?: string;
  reporter?: string;
  created?: string;
  comments?: JiraComment[];
  project?: {
    key: string;
    name: string;
  };
  parent?: JiraIssueParent;
}

export interface JiraComment {
  id: string;
  author: string;
  body: string;
  created: string;
  updated: string;
}

export interface JiraActivityItem {
  issueKey: string;
  teamMember: string;
  activityType: string;
  timestamp: string;
  summary?: string;
}

// ============ Custom Field Configuration ============

/** Mapping of custom field IDs to human-readable names */
export const CUSTOM_FIELD_MAP: Record<string, string> = {
  'customfield_15111': 'Decision Needed',
  'customfield_15112': 'Progress Update',
  'customfield_15113': 'Decision Maker(s)',
  'customfield_15115': 'Risks/Blockers',
  'customfield_15116': 'Completion Percentage',
  'customfield_15117': 'Health Status',
};

/** Reverse mapping: field name to field ID */
export const FIELD_NAME_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(CUSTOM_FIELD_MAP).map(([id, name]) => [name.toLowerCase(), id])
);

/** Field types for validation */
export type CustomFieldType = 'richtext' | 'user' | 'number' | 'select';

export const CUSTOM_FIELD_TYPES: Record<string, CustomFieldType> = {
  'customfield_15111': 'richtext',  // Decision Needed
  'customfield_15112': 'richtext',  // Progress Update
  'customfield_15113': 'user',      // Decision Maker(s)
  'customfield_15115': 'richtext',  // Risks/Blockers
  'customfield_15116': 'number',    // Completion Percentage
  'customfield_15117': 'select',    // Health Status
};

export interface WorkSummaryItem {
  key: string;
  summary: string;
  status: string;
  lastActivityType: string;
}

export interface JiraApiError {
  statusCode: number;
  message: string;
  errors?: Record<string, string>;
}

// ============ Helper Functions ============

/**
 * Validates that all required environment variables are set
 */
function validateConfig(): void {
  const missing: string[] = [];
  if (!JIRA_BASE_URL) missing.push('JIRA_BASE_URL');
  if (!JIRA_USER_EMAIL) missing.push('JIRA_USER_EMAIL');
  if (!JIRA_API_TOKEN) missing.push('JIRA_API_TOKEN');
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Creates the Basic Auth header for Jira API requests
 */
function getAuthHeader(): string {
  const credentials = Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  return `Basic ${credentials}`;
}

/**
 * Makes a request to the Jira REST API
 */
async function jiraFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  validateConfig();
  
  const url = `${JIRA_BASE_URL}/rest/api/3${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorData: JiraApiError;
    try {
      const parsed = JSON.parse(errorBody);
      errorData = {
        statusCode: response.status,
        message: parsed.errorMessages?.join(', ') || parsed.message || response.statusText,
        errors: parsed.errors,
      };
    } catch {
      errorData = {
        statusCode: response.status,
        message: errorBody || response.statusText,
      };
    }
    throw errorData;
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Get the current user's accountId from Jira
 * Results are cached to avoid repeated API calls
 */
async function getCurrentUserAccountId(): Promise<string> {
  if (currentUserAccountId) {
    return currentUserAccountId;
  }

  const response = await jiraFetch<{ accountId: string }>('/myself');
  currentUserAccountId = response.accountId;
  return currentUserAccountId;
}

/**
 * Extracts plain text from Jira's ADF (Atlassian Document Format)
 */
function extractTextFromADF(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  
  const doc = adf as { content?: unknown[] };
  if (!doc.content) return '';
  
  function extractText(nodes: unknown[]): string {
    return nodes.map((node) => {
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === 'text' && n.text) return n.text;
      if (n.content) return extractText(n.content);
      return '';
    }).join(' ');
  }
  
  return extractText(doc.content).trim();
}

// ============ API Functions ============

export interface ProjectComponent {
  id: string;
  name: string;
  description?: string;
}

/**
 * Get all components for a project
 * @param projectKey - The project key (e.g., "TSSE")
 * @returns Array of components with id, name, and description
 */
export async function getProjectComponents(projectKey: string): Promise<ProjectComponent[]> {
  const response = await jiraFetch<Array<{
    id: string;
    name: string;
    description?: string;
  }>>(`/project/${projectKey}/components`);

  return response.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
  }));
}

/**
 * Search for issues using JQL (using the new /search/jql endpoint)
 * @param jql - JQL query string to filter issues
 * @param fields - Array of field names to include in the response
 * @returns Array of Jira issues matching the query
 */
export async function searchIssues(jql: string, fields: string[] = ['summary', 'status', 'priority', 'updated']): Promise<JiraIssue[]> {
  const params = new URLSearchParams({
    jql,
    maxResults: '100',
  });
  // Add fields as separate params (the new API accepts array-style)
  fields.forEach(f => params.append('fields', f));

  const response = await jiraFetch<{
    issues: Array<{
      key: string;
      id: string;
      fields: {
        summary: string;
        status: { name: string };
        priority: { name: string };
        updated: string;
        description?: unknown;
        assignee?: { displayName: string; accountId: string };
        reporter?: { displayName: string; accountId: string };
        created?: string;
        comment?: { comments: Array<{ id: string; author: { displayName: string }; body: unknown; created: string; updated: string }> };
      };
    }>;
    isLast?: boolean;
    nextPageToken?: string;
  }>(`/search/jql?${params.toString()}`);

  return response.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    priority: issue.fields.priority?.name || 'None',
    updated: issue.fields.updated,
  }));
}

/**
 * Get full details of a specific issue including comments
 * @param issueKey - The Jira issue key (e.g., "PROJ-123")
 * @returns Complete issue details including description, comments, and metadata
 */
export async function getIssueDetails(issueKey: string): Promise<JiraIssue> {
  const fields = ['summary', 'status', 'priority', 'updated', 'description', 'assignee', 'reporter', 'created', 'comment', 'project', 'parent'];
  const params = new URLSearchParams({
    fields: fields.join(','),
  });

  const response = await jiraFetch<{
    key: string;
    fields: {
      summary: string;
      status: { name: string };
      priority: { name: string };
      updated: string;
      description?: unknown;
      assignee?: { displayName: string; accountId: string };
      reporter?: { displayName: string; accountId: string };
      created: string;
      comment?: {
        comments: Array<{
          id: string;
          author: { displayName: string };
          body: unknown;
          created: string;
          updated: string;
        }>;
      };
      project?: {
        key: string;
        name: string;
      };
      parent?: {
        key: string;
        fields: {
          summary: string;
          status: { name: string };
          priority: { name: string };
          issuetype: { name: string };
        };
      };
    };
  }>(`/issue/${issueKey}?${params.toString()}`);

  const comments: JiraComment[] = response.fields.comment?.comments.slice(-5).map((c) => ({
    id: c.id,
    author: c.author.displayName,
    body: extractTextFromADF(c.body),
    created: c.created,
    updated: c.updated,
  })) || [];

  // Build parent object if present
  const parent: JiraIssueParent | undefined = response.fields.parent
    ? {
        key: response.fields.parent.key,
        summary: response.fields.parent.fields.summary,
        status: response.fields.parent.fields.status.name,
        priority: response.fields.parent.fields.priority?.name || 'None',
        issueType: response.fields.parent.fields.issuetype.name,
      }
    : undefined;

  return {
    key: response.key,
    summary: response.fields.summary,
    status: response.fields.status.name,
    priority: response.fields.priority?.name || 'None',
    updated: response.fields.updated,
    description: extractTextFromADF(response.fields.description),
    assignee: response.fields.assignee?.displayName,
    reporter: response.fields.reporter?.displayName,
    created: response.fields.created,
    comments,
    project: response.fields.project,
    parent,
  };
}

/**
 * Add a comment to an issue
 * @param issueKey - The Jira issue key (e.g., "PROJ-123")
 * @param commentBody - The text content of the comment
 * @returns Object containing the new comment ID and creation timestamp
 */
export async function addComment(issueKey: string, commentBody: string): Promise<{ id: string; created: string }> {
  const response = await jiraFetch<{
    id: string;
    created: string;
  }>(`/issue/${issueKey}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: commentBody,
              },
            ],
          },
        ],
      },
    }),
  });

  return {
    id: response.id,
    created: response.created,
  };
}

// ============ Issue Creation ============

export interface CreateIssueOptions {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string;
  assignee?: string; // 'currentuser()' or accountId
  priority?: string;
  labels?: string[];
  duedate?: string; // YYYY-MM-DD format
  components?: string[]; // Component names
  // Custom fields
  healthStatus?: string;
  completionPercentage?: number;
  decisionNeeded?: string;
  risksBlockers?: string;
  // Progress Update field sections
  progressUpdate?: {
    weeklyUpdate?: string;
    delivered?: string;
    whatsNext?: string;
  };
  // Any additional custom fields as key-value pairs
  customFields?: Record<string, unknown>;
}

export interface CreateIssueResult {
  key: string;
  id: string;
  self: string;
}

/**
 * Create a new issue in Jira
 * @param options - Issue creation options including project, type, summary, and optional fields
 * @returns The created issue key, id, and self URL
 */
export async function createIssue(options: CreateIssueOptions): Promise<CreateIssueResult> {
  const isTSSEProject = options.projectKey.toUpperCase() === 'TSSE';

  const fields: Record<string, unknown> = {
    project: { key: options.projectKey },
    issuetype: { name: options.issueType },
    summary: options.summary,
  };

  // Add description if provided
  if (options.description) {
    fields.description = createADFDocument(options.description);
  }

  // Add assignee - default to currentuser() for TSSE project
  const assignee = options.assignee ?? (isTSSEProject ? 'currentuser()' : undefined);
  if (assignee) {
    // Handle 'currentuser()' or accountId
    if (assignee.toLowerCase() === 'currentuser()') {
      // Fetch actual accountId for current user (Jira Cloud requires accountId)
      const accountId = await getCurrentUserAccountId();
      fields.assignee = { accountId };
    } else {
      fields.assignee = { accountId: assignee };
    }
  }

  // Add priority if provided
  if (options.priority) {
    fields.priority = { name: options.priority };
  }

  // Add labels - default to ['EngProd', 'TSSP'] for TSSE project
  const labels = options.labels ?? (isTSSEProject ? ['EngProd', 'TSSP'] : undefined);
  if (labels && labels.length > 0) {
    fields.labels = labels;
  }

  // Add duedate - default to 30 days from today for TSSE project
  let duedate = options.duedate;
  if (!duedate && isTSSEProject) {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    duedate = date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }
  if (duedate) {
    fields.duedate = duedate;
  }

  // Add components if provided
  if (options.components && options.components.length > 0) {
    fields.components = options.components.map(name => ({ name }));
  }

  // Add custom fields
  if (options.healthStatus) {
    fields[resolveFieldId('Health Status')] = { value: options.healthStatus };
  }

  // BUG FIX: Completion Percentage field expects decimal (0.0-1.0), not percentage (0-100)
  // Convert percentage input to decimal: 10% -> 0.10
  if (options.completionPercentage !== undefined) {
    const decimalValue = options.completionPercentage / 100;
    fields[resolveFieldId('Completion Percentage')] = decimalValue;
  }

  if (options.decisionNeeded) {
    fields[resolveFieldId('Decision Needed')] = createADFDocument(options.decisionNeeded);
  }

  if (options.risksBlockers) {
    fields[resolveFieldId('Risks/Blockers')] = createADFDocument(options.risksBlockers);
  }

  // Add Progress Update field if provided
  if (options.progressUpdate) {
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const weeklyUpdate = options.progressUpdate.weeklyUpdate || '';
    const delivered = options.progressUpdate.delivered || '';
    const whatsNext = options.progressUpdate.whatsNext || '';

    fields[resolveFieldId('Progress Update')] = createProgressUpdateADF(
      `${currentDate}\n${weeklyUpdate}`,
      delivered,
      whatsNext
    );
  }

  // Add any additional custom fields
  if (options.customFields) {
    for (const [key, value] of Object.entries(options.customFields)) {
      const fieldId = key.startsWith('customfield_') ? key : resolveFieldId(key);
      fields[fieldId] = value;
    }
  }

  const response = await jiraFetch<{
    id: string;
    key: string;
    self: string;
  }>('/issue', {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });

  return {
    key: response.key,
    id: response.id,
    self: response.self,
  };
}

/**
 * Get issues updated by a user within a date range
 * @param username - The Jira username (email) to search for
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @returns Array of issues the user worked on during the specified period
 */
export async function getWorkSummary(
  username: string,
  startDate: string,
  endDate: string
): Promise<WorkSummaryItem[]> {
  // JQL to find issues where the user was involved (assignee, reporter, commenter, or updated)
  const jql = `(assignee = "${username}" OR reporter = "${username}" OR "comment author" = "${username}") AND updated >= "${startDate}" AND updated <= "${endDate}" ORDER BY updated DESC`;

  const issues = await searchIssues(jql, ['summary', 'status', 'priority', 'updated']);

  return issues.map((issue) => ({
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
    lastActivityType: 'updated', // Simplified - could be enhanced with changelog API
  }));
}

/**
 * Get recent activity from team members
 * @param teamMembers - Array of team member emails to track
 * @param timeframeDays - Number of days to look back (default: 7)
 * @returns Array of activity items showing recent team updates
 */
export async function getTeamActivity(
  teamMembers: string[],
  timeframeDays: number = 7
): Promise<JiraActivityItem[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframeDays);
  const startDateStr = startDate.toISOString().split('T')[0];

  // Build JQL for team member activity
  const membersList = teamMembers.map((m) => `"${m}"`).join(', ');
  const jql = `(assignee IN (${membersList}) OR reporter IN (${membersList})) AND updated >= "${startDateStr}" ORDER BY updated DESC`;

  const params = new URLSearchParams({
    jql,
    maxResults: '50',
  });
  // Add fields as separate params for the new API
  ['summary', 'status', 'assignee', 'updated'].forEach(f => params.append('fields', f));

  const response = await jiraFetch<{
    issues: Array<{
      key: string;
      id: string;
      fields: {
        summary: string;
        status: { name: string };
        assignee?: { displayName: string; accountId: string };
        updated: string;
      };
    }>;
    isLast?: boolean;
    nextPageToken?: string;
  }>(`/search/jql?${params.toString()}`);

  return response.issues.map((issue) => ({
    issueKey: issue.key,
    teamMember: issue.fields.assignee?.displayName || 'Unassigned',
    activityType: 'issue_updated',
    timestamp: issue.fields.updated,
    summary: issue.fields.summary,
  }));
}

// ============ ADF (Atlassian Document Format) Helpers ============

/**
 * Creates a simple ADF document from plain text
 * @param text - Plain text content to wrap in ADF format
 * @returns ADF document object suitable for Jira rich text fields
 */
export function createADFDocument(text: string): object {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: text,
          },
        ],
      },
    ],
  };
}

/**
 * Creates an ADF paragraph with optional emoji prefix
 */
function createADFParagraph(text: string, emoji?: { shortName: string; id: string; text: string }): object {
  const content: object[] = [];

  if (emoji) {
    content.push({
      type: 'emoji',
      attrs: emoji,
    });
  }

  content.push({
    type: 'text',
    text: emoji ? ` ${text}` : text,
    marks: text.endsWith(':') ? [{ type: 'strong' }] : undefined,
  });

  return {
    type: 'paragraph',
    content,
  };
}

/**
 * Creates the Progress Update ADF document with the three-section template
 * @param weeklyUpdate - Content for the weekly update section (typically includes date)
 * @param delivered - Content for the "What we've delivered" section
 * @param whatsNext - Content for the "What's next" section
 * @returns ADF document object with the three-section progress template
 */
export function createProgressUpdateADF(
  weeklyUpdate: string,
  delivered: string,
  whatsNext: string
): object {
  return {
    type: 'doc',
    version: 1,
    content: [
      createADFParagraph(
        `Update for week of ${weeklyUpdate}:`,
        { shortName: ':info:', id: 'atlassian-info', text: ':info:' }
      ),
      createADFParagraph(
        `What we've delivered so far: ${delivered}`,
        { shortName: ':check_mark:', id: 'atlassian-check_mark', text: ':check_mark:' }
      ),
      createADFParagraph(
        `What's next: ${whatsNext}`,
        { shortName: ':question:', id: 'atlassian-question_mark', text: ':question:' }
      ),
    ],
  };
}

// ============ Custom Field Update Functions ============

/**
 * Resolves a field name or ID to the actual field ID
 * @param fieldNameOrId - Either a custom field ID (e.g., "customfield_15111") or field name (e.g., "Decision Needed")
 * @returns The resolved customfield ID
 * @throws Error if the field name is not recognized
 */
export function resolveFieldId(fieldNameOrId: string): string {
  // If it's already a customfield ID, return as-is
  if (fieldNameOrId.startsWith('customfield_')) {
    return fieldNameOrId;
  }

  // Try to find by name (case-insensitive)
  const fieldId = FIELD_NAME_TO_ID[fieldNameOrId.toLowerCase()];
  if (fieldId) {
    return fieldId;
  }

  throw new Error(`Unknown field: "${fieldNameOrId}". Valid fields are: ${Object.values(CUSTOM_FIELD_MAP).join(', ')}`);
}

/**
 * Get a specific custom field value from an issue
 * @param issueKey - The Jira issue key (e.g., "PROJ-123")
 * @param fieldId - The field name or customfield ID to retrieve
 * @returns The raw field value from Jira (may be ADF for rich text fields)
 */
export async function getIssueCustomField(issueKey: string, fieldId: string): Promise<unknown> {
  const resolvedFieldId = resolveFieldId(fieldId);

  const response = await jiraFetch<{
    fields: Record<string, unknown>;
  }>(`/issue/${issueKey}?fields=${resolvedFieldId}`);

  return response.fields[resolvedFieldId];
}

/**
 * Update a custom field on an issue
 * @param issueKey - The Jira issue key (e.g., "PROJ-123")
 * @param fieldNameOrId - Field name (e.g., "Health Status") or ID (e.g., "customfield_15117")
 * @param value - Value to set (type depends on field: string, number, or object)
 * @returns Object indicating success and the resolved field ID and name
 * @throws Error if the field type validation fails
 */
export async function updateIssueField(
  issueKey: string,
  fieldNameOrId: string,
  value: unknown
): Promise<{ success: boolean; fieldId: string; fieldName: string }> {
  const fieldId = resolveFieldId(fieldNameOrId);
  const fieldName = CUSTOM_FIELD_MAP[fieldId] || fieldId;
  const fieldType = CUSTOM_FIELD_TYPES[fieldId];

  let formattedValue: unknown;

  switch (fieldType) {
    case 'richtext':
      // If value is already an ADF object, use it; otherwise create one from text
      if (typeof value === 'object' && value !== null && 'type' in value) {
        formattedValue = value;
      } else {
        formattedValue = createADFDocument(String(value));
      }
      break;
    case 'number':
      formattedValue = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(formattedValue as number)) {
        throw new Error(`Invalid number value for ${fieldName}: ${value}`);
      }
      // Special handling for Completion Percentage: convert percentage (0-100) to decimal (0.0-1.0)
      if (fieldId === 'customfield_15116') {
        formattedValue = (formattedValue as number) / 100;
      }
      break;
    case 'select':
      // Select fields need to be set with { value: "option" } format
      formattedValue = typeof value === 'object' ? value : { value: String(value) };
      break;
    case 'user':
      // User picker fields need accountId
      formattedValue = typeof value === 'object' ? value : { accountId: String(value) };
      break;
    default:
      formattedValue = value;
  }

  await jiraFetch<void>(`/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({
      fields: {
        [fieldId]: formattedValue,
      },
    }),
  });

  return { success: true, fieldId, fieldName };
}

/**
 * Update labels on an issue
 * @param issueKey - The Jira issue key (e.g., "PROJ-123")
 * @param labels - Array of label strings to set on the issue
 * @returns Object indicating success
 */
export async function updateIssueLabels(
  issueKey: string,
  labels: string[]
): Promise<{ success: boolean }> {
  await jiraFetch<void>(`/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({
      fields: {
        labels: labels,
      },
    }),
  });

  return { success: true };
}

/**
 * Recursively extract all text from an ADF node
 */
function extractTextFromADFNode(node: unknown): string {
  if (!node || typeof node !== 'object') return '';

  const n = node as { type?: string; text?: string; content?: unknown[] };

  // If it's a text node, return the text
  if (n.type === 'text' && n.text) {
    return n.text;
  }

  // If it has content, recursively extract from children
  if (n.content && Array.isArray(n.content)) {
    return n.content.map(child => extractTextFromADFNode(child)).join(' ').trim();
  }

  return '';
}

/**
 * Extract bullet list items from an ADF node
 */
function extractBulletListItems(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];

  const n = node as { type?: string; content?: unknown[] };

  if (n.type === 'bulletList' && n.content) {
    return n.content.map(item => {
      const listItem = item as { content?: unknown[] };
      if (listItem.content) {
        return listItem.content.map(p => extractTextFromADFNode(p)).join(' ').trim();
      }
      return '';
    }).filter(text => text.length > 0);
  }

  return [];
}

/**
 * Parse the Progress Update field to extract existing section content
 * Handles both simple paragraph format and complex panel/bullet list format
 */
function parseProgressUpdateADF(adf: unknown): {
  weeklyUpdate: string;
  delivered: string;
  whatsNext: string;
} {
  const result = {
    weeklyUpdate: '[date]',
    delivered: '',
    whatsNext: '',
  };

  if (!adf || typeof adf !== 'object') return result;

  const doc = adf as { content?: unknown[] };
  if (!doc.content || !Array.isArray(doc.content)) return result;

  // Track which section we're currently parsing
  let currentSection: 'weekly' | 'delivered' | 'whatsNext' | null = null;

  for (const block of doc.content) {
    const b = block as { type?: string; content?: unknown[]; attrs?: unknown };

    // Handle panel blocks (complex format)
    if (b.type === 'panel' && b.content) {
      let panelHeader = '';
      const panelItems: string[] = [];

      for (const panelChild of b.content) {
        const pc = panelChild as { type?: string; content?: unknown[] };

        // Extract heading text
        if (pc.type === 'heading') {
          panelHeader = extractTextFromADFNode(pc);
        }

        // Extract bullet list items
        if (pc.type === 'bulletList') {
          panelItems.push(...extractBulletListItems(pc));
        }
      }

      // Determine which section based on header (handle both straight and curly apostrophes)
      const normalizedHeader = panelHeader.replace(/[']/g, "'");

      if (normalizedHeader.includes('Update for week of')) {
        const dateMatch = panelHeader.match(/Update for week of ([^:]+):/);
        result.weeklyUpdate = dateMatch ? dateMatch[1].trim() : '[date]';
        if (panelItems.length > 0) {
          result.weeklyUpdate += ' - ' + panelItems.join('. ');
        }
      } else if (normalizedHeader.includes('delivered so far')) {
        result.delivered = panelItems.join('. ');
      } else if (normalizedHeader.includes("What's next")) {
        result.whatsNext = panelItems.join('. ');
      }
      continue;
    }

    // Handle simple paragraph format
    if (b.type === 'paragraph' && b.content) {
      const paragraphText = extractTextFromADFNode(b);

      // Check for section headers
      const weeklyMatch = paragraphText.match(/Update for week of ([^:]+):(.*)/);
      if (weeklyMatch) {
        result.weeklyUpdate = weeklyMatch[1].trim();
        if (weeklyMatch[2]?.trim()) {
          result.weeklyUpdate += ' - ' + weeklyMatch[2].trim();
        }
        currentSection = 'weekly';
        continue;
      }

      const deliveredMatch = paragraphText.match(/What we['']ve delivered so far:(.*)/);
      if (deliveredMatch) {
        result.delivered = deliveredMatch[1]?.trim() || '';
        currentSection = 'delivered';
        continue;
      }

      const whatsNextMatch = paragraphText.match(/What['']s next:(.*)/);
      if (whatsNextMatch) {
        result.whatsNext = whatsNextMatch[1]?.trim() || '';
        currentSection = 'whatsNext';
        continue;
      }

      // If we're in a section and this is additional content, append it
      if (currentSection && paragraphText.trim()) {
        switch (currentSection) {
          case 'weekly':
            result.weeklyUpdate += (result.weeklyUpdate.includes(' - ') ? '. ' : ' - ') + paragraphText.trim();
            break;
          case 'delivered':
            result.delivered += (result.delivered ? '. ' : '') + paragraphText.trim();
            break;
          case 'whatsNext':
            result.whatsNext += (result.whatsNext ? '. ' : '') + paragraphText.trim();
            break;
        }
      }
    }
  }

  return result;
}

// ============ Sprint Tasks Functions ============

/**
 * Month abbreviations for sprint label format (MonDD-DD)
 */
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Calculates the Monday-Friday date range for a given week and returns the sprint label format.
 * Sprint labels follow the format: MonDD-DD (e.g., Dec15-19 for December 15-19)
 *
 * @param weekOffset - 0 for current week, 1 for next week
 * @returns Object containing the sprint label and the Monday/Friday dates
 */
export function calculateSprintLabel(weekOffset: number = 0): {
  label: string;
  mondayDate: Date;
  fridayDate: Date;
} {
  const now = new Date();

  // Find Monday of the current week
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysUntilMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // If Sunday, go back 6 days

  const monday = new Date(now);
  monday.setDate(now.getDate() + daysUntilMonday + (weekOffset * 7));
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  const month = MONTH_ABBR[monday.getMonth()];
  const mondayDay = monday.getDate();
  const fridayDay = friday.getDate();

  // Format: MonDD-DD (e.g., Dec15-19)
  // If the week spans two months, still use the Monday's month
  const label = `${month}${mondayDay}-${fridayDay}`;

  return { label, mondayDate: monday, fridayDate: friday };
}

export interface SprintTask {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee?: string;
  updated: string;
}

export interface SprintTasksResult {
  sprintLabel: string;
  weekRange: {
    monday: string;
    friday: string;
  };
  tasks: SprintTask[];
}

/**
 * Get sprint tasks for the current week or next week
 *
 * @param week - 'this_week' or 'next_week'
 * @param scope - 'my_tasks' for current user's tasks, 'team_tasks' for all team tasks
 * @param currentUser - The current user identifier (for 'my_tasks' scope)
 * @returns Sprint tasks result with label, date range, and matching tasks
 */
export async function getSprintTasks(
  week: 'this_week' | 'next_week',
  scope: 'my_tasks' | 'team_tasks',
  currentUser?: string
): Promise<SprintTasksResult> {
  const weekOffset = week === 'this_week' ? 0 : 1;
  const { label, mondayDate, fridayDate } = calculateSprintLabel(weekOffset);

  // Build JQL query to find issues with the sprint label
  let jql = `labels = "${label}"`;

  // Filter by assignee if scope is 'my_tasks'
  if (scope === 'my_tasks') {
    if (!currentUser) {
      throw new Error('currentUser is required for my_tasks scope');
    }
    jql += ` AND assignee = ${currentUser}`;
  }

  // Order by priority then status
  jql += ' ORDER BY priority DESC, status ASC';

  // Search for issues with the matching label
  const params = new URLSearchParams({
    jql,
    maxResults: '100',
  });
  ['summary', 'status', 'priority', 'assignee', 'updated'].forEach(f => params.append('fields', f));

  const response = await jiraFetch<{
    issues: Array<{
      key: string;
      id: string;
      fields: {
        summary: string;
        status: { name: string };
        priority: { name: string };
        assignee?: { displayName: string; accountId: string };
        updated: string;
      };
    }>;
  }>(`/search/jql?${params.toString()}`);

  const tasks: SprintTask[] = response.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    priority: issue.fields.priority?.name || 'None',
    assignee: issue.fields.assignee?.displayName,
    updated: issue.fields.updated,
  }));

  return {
    sprintLabel: label,
    weekRange: {
      monday: mondayDate.toISOString().split('T')[0],
      friday: fridayDate.toISOString().split('T')[0],
    },
    tasks,
  };
}

/**
 * Update the Progress Update field with template-aware behavior
 *
 * The Progress Update field uses a three-section template:
 * - ℹ️ Update for week of [date]: Weekly status
 * - ✅ What we've delivered so far: Accomplishments
 * - ❓ What's next: Upcoming work
 *
 * @param issueKey - The Jira issue key (e.g., "PROJ-123")
 * @param options - Update options
 * @param options.refreshDate - If true, updates the date to today while preserving all existing content
 * @param options.weeklyUpdate - Replace the weekly update content (auto-prepends current date)
 * @param options.delivered - Replace the delivered section content
 * @param options.whatsNext - Replace the what's next section content
 * @returns Object with success status, list of updated sections, and parsed existing content
 */
export async function updateProgressField(
  issueKey: string,
  options: {
    refreshDate?: boolean;
    weeklyUpdate?: string;
    delivered?: string;
    whatsNext?: string;
  }
): Promise<{ success: boolean; updatedSections: string[]; parsedExisting?: { weeklyUpdate: string; delivered: string; whatsNext: string } }> {
  const PROGRESS_FIELD_ID = 'customfield_15112';

  // Fetch current field value
  const currentValue = await getIssueCustomField(issueKey, PROGRESS_FIELD_ID);

  // Parse existing content
  const existing = parseProgressUpdateADF(currentValue);

  // Format current date
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Determine which sections to update
  const updatedSections: string[] = [];

  let weeklyUpdate = existing.weeklyUpdate;
  let delivered = existing.delivered;
  let whatsNext = existing.whatsNext;

  // Handle refreshDate option - preserve existing content but update the date
  if (options.refreshDate) {
    // Extract just the content part from weeklyUpdate (remove old date or [date] placeholder if present)
    // The parsed weeklyUpdate may be:
    // - "December 10, 2025 - Some content"
    // - "[date] - Some content"
    // - Just "[date]"
    // - Just content with no date prefix
    let contentOnly = weeklyUpdate;

    // Remove date pattern like "December 10, 2025 - " or "December 10, 2025"
    const dateMatch = contentOnly.match(/^[A-Z][a-z]+ \d{1,2}, \d{4}\s*-?\s*/);
    if (dateMatch) {
      contentOnly = contentOnly.slice(dateMatch[0].length);
    }

    // Remove [date] placeholder pattern like "[date] - " or "[date]"
    const placeholderMatch = contentOnly.match(/^\[date\]\s*-?\s*/);
    if (placeholderMatch) {
      contentOnly = contentOnly.slice(placeholderMatch[0].length);
    }

    contentOnly = contentOnly.trim();
    weeklyUpdate = contentOnly ? `${currentDate} - ${contentOnly}` : currentDate;
    updatedSections.push('weeklyUpdate (date refreshed)');
  }

  // Handle explicit weeklyUpdate option
  if (options.weeklyUpdate !== undefined) {
    weeklyUpdate = options.weeklyUpdate ? `${currentDate} - ${options.weeklyUpdate}` : currentDate;
    updatedSections.push('weeklyUpdate');
  }

  if (options.delivered !== undefined) {
    delivered = options.delivered;
    updatedSections.push('delivered');
  }

  if (options.whatsNext !== undefined) {
    whatsNext = options.whatsNext;
    updatedSections.push('whatsNext');
  }

  // Create the updated ADF document
  const updatedADF = createProgressUpdateADF(weeklyUpdate, delivered, whatsNext);

  // Update the field
  await jiraFetch<void>(`/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({
      fields: {
        [PROGRESS_FIELD_ID]: updatedADF,
      },
    }),
  });

  return {
    success: true,
    updatedSections,
    parsedExisting: existing,
  };
}

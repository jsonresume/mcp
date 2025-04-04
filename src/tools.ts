import { Tool } from "@modelcontextprotocol/sdk/types.js";

// Define MCP tools
export const ANALYZE_CODEBASE_TOOL: Tool = {
  name: "github_analyze_codebase",
  description: "This is a tool from the github MCP server.\nAnalyzes the current codebase and returns information about technologies, languages, and recent commits",
  inputSchema: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description: "The directory to analyze. If not provided, uses current working directory.",
      },
    },
    required: [],
  },
};

export const CHECK_RESUME_TOOL: Tool = {
  name: "github_check_resume",
  description: "This is a tool from the github MCP server.\nChecks if a GitHub user has a JSON Resume and returns its information",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const ENHANCE_RESUME_WITH_PROJECT_TOOL: Tool = {
  name: "github_enhance_resume_with_project",
  description: "This is a tool from the github MCP server.\nEnhances a GitHub user's JSON Resume with information about their current project",
  inputSchema: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description: "The directory of the project to analyze. If not provided, uses current working directory.",
      },
    },
    required: [],
  },
};

// Export all tools as an array for convenience
export const tools = [
  ANALYZE_CODEBASE_TOOL,
  CHECK_RESUME_TOOL,
  ENHANCE_RESUME_WITH_PROJECT_TOOL,
];

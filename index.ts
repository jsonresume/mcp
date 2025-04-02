import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { serve } from '@hono/node-server';
import express from 'express';
import type { Request, Response } from 'express';
import type { Context } from 'hono';

import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { GitHubService } from "./src/github.js";
import { OpenAIService } from "./src/openai.js";
import { Resume } from "./src/types.js";
import { CodebaseAnalyzer } from "./src/codebase.js";
import { ResumeEnhancer } from "./src/resume-enhancer.js";

const mcpServer = new Server(
  {
    name: "jsonresume-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      logging: {},
    },
  }
);

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

// Initialize services
let githubService: GitHubService;
let openaiService: OpenAIService;
let codebaseAnalyzer: CodebaseAnalyzer;
let resumeEnhancer: ResumeEnhancer;

try {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  if (!GITHUB_USERNAME) {
    throw new Error("GITHUB_USERNAME environment variable is required");
  }

  githubService = new GitHubService(GITHUB_TOKEN, GITHUB_USERNAME);
  openaiService = new OpenAIService(OPENAI_API_KEY);
  codebaseAnalyzer = new CodebaseAnalyzer(process.cwd());
  resumeEnhancer = new ResumeEnhancer(openaiService);
  
  console.log("Services initialized successfully");
} catch (error) {
  console.log("Error initializing services:", error);
  process.exit(1);
}

// Define MCP tools
const ANALYZE_CODEBASE_TOOL: Tool = {
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

const CHECK_RESUME_TOOL: Tool = {
  name: "github_check_resume",
  description: "This is a tool from the github MCP server.\nChecks if a GitHub user has a JSON Resume and returns its information",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

const ENHANCE_RESUME_WITH_PROJECT_TOOL: Tool = {
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

const tools = [
  ANALYZE_CODEBASE_TOOL,
  CHECK_RESUME_TOOL,
  ENHANCE_RESUME_WITH_PROJECT_TOOL,
];

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

function doHello(name: string) {
  return {
    message: `Hello, ${name}!`,
  };
}

async function analyzeCodebase(directory?: string) {
  try {
    console.log("Starting codebase analysis...");
    
    // Create a new analyzer for the specified directory
    const analyzer = directory ? new CodebaseAnalyzer(directory) : codebaseAnalyzer;
    
    // Analyze the codebase
    const analysis = await analyzer.analyze();
    
    console.log("Codebase analysis completed");
    
    return {
      message: "Codebase analysis completed successfully",
      analysis,
      summary: analysis.summary
    };
  } catch (error) {
    console.log("Error analyzing codebase:", error);
    throw error;
  }
}

async function checkResume() {
  try {
    console.log("Checking for existing resume...");
    
    // Fetch the user's resume from GitHub gists
    const resume = await githubService.getResumeFromGists();
    
    if (!resume) {
      return {
        message: "No resume found",
        exists: false,
        resumeUrl: null
      };
    }
    
    // Remove the _gistId property for cleaner output
    const { _gistId, ...cleanResume } = resume;
    
    return {
      message: "Resume found",
      exists: true,
      resumeUrl: `https://registry.jsonresume.org/${GITHUB_USERNAME}`,
      resume: cleanResume
    };
  } catch (error) {
    console.log("Error checking resume:", error);
    throw error;
  }
}

async function enhanceResumeWithProject(directory?: string) {
  try {
    console.log("Starting resume enhancement with current project...");
    
    // Step 1: Fetch the user's resume from GitHub gists
    console.log("Fetching resume from GitHub gists...");
    let resume = await githubService.getResumeFromGists();
    
    if (!resume) {
      // If no resume exists, create a sample one
      console.log("No resume found, creating a sample resume...");
      const userProfile = await githubService.getUserProfile();
      resume = await githubService.createSampleResume();
      console.log("Sample resume created successfully");
    } else {
      console.log("Existing resume found");
    }
    
    // Step 2: Analyze the current codebase
    console.log("Analyzing current project...");
    const analyzer = directory ? new CodebaseAnalyzer(directory) : codebaseAnalyzer;
    const codebaseAnalysis = await analyzer.analyze();
    
    // Step 3: Enhance the resume with the current project
    console.log("Enhancing resume with current project...");
    const { updatedResume, changes, summary, userMessage, resumeLink } = await resumeEnhancer.enhanceWithCurrentProject(
      resume,
      codebaseAnalysis,
      GITHUB_USERNAME || ''
    );
    
    // Step 4: Update the resume on GitHub
    console.log("Updating resume on GitHub...");
    const finalResume = await githubService.updateResume(updatedResume);
    
    return {
      message: "Resume enhanced with current project successfully",
      changes: changes,
      summary,
      userMessage,
      resumeUrl: resumeLink || `https://registry.jsonresume.org/${GITHUB_USERNAME}`,
      projectName: codebaseAnalysis.repoName,
      warning: "⚠️ Note: Automatic resume updates might have modified your resume in ways that don't match your preferences. You can revert to a previous version through your GitHub Gist revision history if needed."
    };
  } catch (error) {
    console.log("Error enhancing resume with project:", error);
    throw error;
  }
}

mcpServer.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  if (request.params.name === "github_hello_tool") {
    console.log("Hello tool", request.params.arguments);
    const input = request.params.arguments as { name: string };
    return doHello(input.name);
  } else if (request.params.name === "github_analyze_codebase") {
    console.log("Analyze codebase tool", request.params.arguments);
    const input = request.params.arguments as { directory?: string };
    return await analyzeCodebase(input.directory);
  } else if (request.params.name === "github_check_resume") {
    console.log("Check resume tool", request.params.arguments);
    return await checkResume();
  } else if (request.params.name === "github_enhance_resume_with_project") {
    console.log("Enhance resume with project tool", request.params.arguments);
    const input = request.params.arguments as { directory?: string };
    return await enhanceResumeWithProject(input.directory);
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
});

mcpServer.onerror = (error: any) => {
  console.log(error);
};

process.on("SIGINT", async () => {
  await mcpServer.close();
  if (expressServer) expressServer.close();
  process.exit(0);
});

let expressServer: ReturnType<typeof expressApp.listen>;

// Express app for MCP/SSE
const expressApp = express();
let transport: SSEServerTransport;

expressApp.get('/', (req: Request, res: Response) => {
  res.send('JsonResume MCP Server');
});

expressApp.get('/sse', async (req: Request, res: Response) => {
  console.log('Configuring SSE transport');
  transport = new SSEServerTransport('/messages', res);
  await mcpServer.connect(transport);
});

expressApp.post('/messages', async (req: Request, res: Response) => {
  if (!transport) {
    console.log('No transport found.');
    return res.status(400).send('No transport found');
  }
  await transport.handlePostMessage(req, res);
  return res.status(200).send('');
});

// Hono app as proxy
const app = new Hono();

app.get('/', (c) => c.text('JsonResume MCP Server - Hono Proxy'));

async function runServer() {
  // Check if 'sse' is passed as a command line argument
  const useSSE = process.argv.includes('sse');
  
  if (useSSE) {
    // Start the SSE server
    const port = process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] ?? 9921;
    
    // Start Express server for MCP/SSE on port 9921
    expressServer = expressApp.listen(port, () => {
      console.log(`JsonResume MCP Server running with SSE on port ${port}`);
      console.log(`Connect to SSE endpoint at http://localhost:${port}/sse`);
    });

    // Start Hono server on port 9922
    const honoPort = 9922;
    app.get('*', async (c) => {
      const url = new URL(c.req.url);
      url.port = port.toString();
      const headers = new Headers(c.req.header());
      const response = await fetch(url.toString(), { headers });
      return new Response(response.body, response);
    });

    app.post('*', async (c) => {
      const url = new URL(c.req.url);
      url.port = port.toString();
      const headers = new Headers(c.req.header());
      const body = await c.req.arrayBuffer();
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body
      });
      return new Response(response.body, response);
    });

    serve({ fetch: app.fetch, port: honoPort });
    console.log(`Hono proxy server running on port ${honoPort}`);
  } else {
    // Start the stdio server (default)
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.log("JsonResume MCP Server running on stdio");
  }
}

runServer().catch((error) => {
  console.log("Fatal error running server:", error);
  process.exit(1);
});

export default app;
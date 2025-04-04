import { config } from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
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
import { tools, ANALYZE_CODEBASE_TOOL, CHECK_RESUME_TOOL, ENHANCE_RESUME_WITH_PROJECT_TOOL } from "./src/tools.js";

// Load environment variables from .env file
config();

const server = new Server(
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

// Environment variables (loaded from .env file via dotenv)
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



server.setRequestHandler(ListToolsRequestSchema, async () => ({
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "github_hello_tool") {
    console.log("Hello tool", request.params.arguments);
    const input = request.params.arguments as { name: string };
    return doHello(input.name);
  } else if (request.params.name === ANALYZE_CODEBASE_TOOL.name) {
    console.log("Analyze codebase tool", request.params.arguments);
    const input = request.params.arguments as { directory?: string };
    return await analyzeCodebase(input.directory);
  } else if (request.params.name === CHECK_RESUME_TOOL.name) {
    console.log("Check resume tool", request.params.arguments);
    return await checkResume();
  } else if (request.params.name === ENHANCE_RESUME_WITH_PROJECT_TOOL.name) {
    console.log("Enhance resume with project tool", request.params.arguments);
    const input = request.params.arguments as { directory?: string };
    return await enhanceResumeWithProject(input.directory);
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
});

server.onerror = (error: any) => {
  console.log(error);
};

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("JsonResume MCP Server running on stdio");
}

runServer().catch((error) => {
  console.log("Fatal error running server:", error);
  process.exit(1);
});

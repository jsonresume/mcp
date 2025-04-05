import { config } from "dotenv";
import { Server } from "../typescript-sdk/src/server/index.js";
import { StdioServerTransport } from "../typescript-sdk/src/server/stdio.js";
import { SSEServerTransport } from "../typescript-sdk/src/server/sse.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Tool,
} from "../typescript-sdk/src/types.js";
import { GitHubService } from "./src/github.js";
import { OpenAIService } from "./src/openai.js";
import { Resume } from "./src/types.js";
import { CodebaseAnalyzer } from "./src/codebase.js";
import { ResumeEnhancer } from "./src/resume-enhancer.js";
import { tools, ANALYZE_CODEBASE_TOOL, CHECK_RESUME_TOOL, ENHANCE_RESUME_WITH_PROJECT_TOOL } from "./src/tools.js";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

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

async function runStdioServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("JsonResume MCP Server running on stdio");
}

async function runHttpServer() {
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const app = new Hono();
  
  app.get('/', (c) => {
    return c.json({
      message: 'Hello, I\'m JSON Resume MCP Server',
      description: 'This is a ModelContextProtocol server for enhancing JSON Resumes',
      usage: {
        http: 'npx -y @jsonresume/mcp',
        stdio: 'npx -y @jsonresume/mcp stdio'
      },
      version: '3.0.3'
    });
  });
  
  // Add SSE endpoint
  app.get('/sse', async (c) => {
    // Set up SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    
    // Create a monkey-patched SSE transport that works with Hono
    console.log("Creating monkey-patched SSE transport");
    
    // Create a wrapper for the Hono response object to mimic Node's ServerResponse
    const honoResponseAdapter = {
      // Store data that will be written to the response
      _data: [] as string[],
      
      // Track if headers have been sent
      headersSent: false,
      
      // Mimic writeHead method
      writeHead: function(statusCode: number, headers?: Record<string, string>) {
        console.log(`[Adapter] writeHead called with status ${statusCode}`);
        // Headers are already set at the Hono level, so we just track that headers were sent
        this.headersSent = true;
        return this;
      },
      
      // Mimic write method
      write: function(chunk: string) {
        console.log(`[Adapter] write called with chunk length ${chunk.length}`);
        this._data.push(chunk);
        return true;
      },
      
      // Mimic end method
      end: function() {
        console.log(`[Adapter] end called`);
        return this;
      },
      
      // Add EventEmitter-like functionality
      _listeners: {} as Record<string, Function[]>,
      on: function(event: string, listener: Function) {
        console.log(`[Adapter] Adding listener for ${event}`);
        if (!this._listeners[event]) {
          this._listeners[event] = [];
        }
        this._listeners[event].push(listener);
        return this;
      },
      
      // Method to get all accumulated data
      getAllData: function() {
        return this._data.join('');
      }
    };
    
    // Create transport with the adapter
    const transport = new SSEServerTransport("/mcp", honoResponseAdapter as unknown as ServerResponse);
    
    console.log("Connecting transport to server");
    await server.connect(transport);
    console.log("Transport connected to server")


    // Keep the connection alive
    return new Response(
      new ReadableStream({
        start(controller) {
          console.log("[SSE Handler] Stream started");
          
          // Send an initial event
          controller.enqueue('event: connected\ndata: {"status":"connected"}\n\n');
          
          // Add adapter method to forward data from the adapter to the stream
          const adapter = transport['res'] as any;
          const originalWrite = adapter.write;
          adapter.write = function(chunk: string) {
            console.log(`[Stream Relay] Received chunk of length ${chunk.length}, forwarding to client`);
            controller.enqueue(chunk);
            return originalWrite.call(this, chunk);
          };
          
          // Set up transport event handlers for MCP messages
          transport.onmessage = (message) => {
            console.log(`[SSE Handler] Received message from transport:`, message);
            controller.enqueue(`data: ${JSON.stringify(message)}\n\n`);
          };
          
          // Add handler for errors
          transport.onerror = (error) => {
            console.error(`[SSE Handler] Transport error:`, error);
            controller.error(error);
          };
          
          // Handle client disconnect
          c.req.raw.signal.addEventListener('abort', () => {
            console.log(`[SSE Handler] Client disconnected, closing transport`);
            // server.close();
            // controller.close();
          });
        }
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      }
    );
  });
  
  console.log(`JsonResume MCP Server starting on port ${PORT}...`);
  serve({
    fetch: app.fetch,
    port: Number(PORT)
  });
  
  console.log(`JsonResume MCP Server running at http://localhost:${PORT}`);
  console.log(`SSE endpoint available at http://localhost:${PORT}/sse`);
  console.log(`To use in stdio mode, run: npx -y @jsonresume/mcp stdio`);
}

// Determine which server mode to run based on command line arguments
const args = process.argv.slice(2);
const shouldRunStdio = args.includes('stdio');

if (shouldRunStdio) {
  runStdioServer().catch((error) => {
    console.log("Fatal error running stdio server:", error);
    process.exit(1);
  });
} else {
  runHttpServer().catch((error) => {
    console.log("Fatal error running HTTP server:", error);
    process.exit(1);
  });
}

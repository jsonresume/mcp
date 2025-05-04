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
  try {
    console.log(`[MCP] Tool call: ${request.params.name}`, request.params.arguments);
    
    // Validate the tool name
    if (!tools.some(tool => tool.name === request.params.name)) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Error: Unknown tool '${request.params.name}'`
        }]
      };
    }
    
    // Execute the appropriate tool
    if (request.params.name === "github_hello_tool") {
      const input = request.params.arguments as { name: string };
      const result = doHello(input.name);
      
      return {
        content: [{
          type: "text",
          text: result.message
        }]
      };
    } else if (request.params.name === ANALYZE_CODEBASE_TOOL.name) {
      const input = request.params.arguments as { directory?: string };
      const result = await analyzeCodebase(input.directory);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } else if (request.params.name === CHECK_RESUME_TOOL.name) {
      const result = await checkResume();
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } else if (request.params.name === ENHANCE_RESUME_WITH_PROJECT_TOOL.name) {
      const input = request.params.arguments as { directory?: string };
      const result = await enhanceResumeWithProject(input.directory);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
    
    // This should never happen due to our validation above
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Error: Tool '${request.params.name}' implementation not found`
      }]
    };
  } catch (error) {
    console.error(`[MCP] Error executing tool ${request.params.name}:`, error);
    
    // Return a proper error response
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Error executing tool: ${error.message || String(error)}`
      }]
    };
  }
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
  
  // Add MCP message endpoint for client->server communication
  app.post('/message', async (c) => {
    const sessionId = c.req.query('sessionId');
    if (!sessionId) {
      return c.json({ error: 'No session ID provided' }, 400);
    }

    try {
      const body = await c.req.json();
      console.log(`[MCP] Received message for session ${sessionId}:`, body);
      
      // Find the transport for this session and handle the message
      const transport = activeTransports.get(sessionId);
      if (!transport) {
        return c.json({ error: 'Invalid session ID' }, 404);
      }
      
      // Special handling for initialize message
      if (body.method === 'initialize') {
        console.log(`[MCP] Handling initialize message for session ${sessionId}`);
        // Send initialize response directly via SSE
        const response = {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            serverInfo: {
              name: "jsonresume-mcp",
              version: "1.0.0",
            },
            capabilities: {
              tools: {},
              resources: {},
              logging: {}
            }
          }
        };
        
        // Let's directly use the controller we stored when setting up the SSE connection
        console.log(`[MCP] Sending initialize response to session ${sessionId}`);
        
        // Store controllers along with transports
        const sseData = `data: ${JSON.stringify(response)}\n\n`;
        
        // Directly write to the response stream
        // This bypasses the transport's send method
        const res = transport['res'];
        if (res && typeof res.write === 'function') {
          try {
            res.write(sseData);
            console.log(`[MCP] Successfully wrote initialize response to stream`);
          } catch (error) {
            console.error(`[MCP] Error writing to stream:`, error);
          }
        } else {
          console.error(`[MCP] Could not access response object for session ${sessionId}`);
        }
        
        return c.json({ status: 'ok' });
      }
      
      await transport.handlePostMessage(c.req.raw, new Response() as any, body);
      return c.json({ status: 'ok' });
    } catch (error) {
      console.error(`[MCP] Error handling message:`, error);
      return c.json({ error: String(error) }, 500);
    }
  });

  // Store active SSE transports
  const activeTransports = new Map<string, SSEServerTransport>();

  // Add SSE endpoint for server->client streaming
  app.get('/sse', async (c) => {
    // Set up SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    
    // Create a wrapper for the Hono response object to mimic Node's ServerResponse
    const honoResponseAdapter = {
      _data: [] as string[],
      headersSent: false,
      writeHead: function(statusCode: number, headers?: Record<string, string>) {
        console.log(`[Adapter] writeHead called with status ${statusCode}`);
        this.headersSent = true;
        return this;
      },
      write: function(chunk: string) {
        console.log(`[Adapter] write called with chunk length ${chunk.length}`);
        this._data.push(chunk);
        return true;
      },
      end: function() {
        console.log(`[Adapter] end called`);
        return this;
      },
      _listeners: {} as Record<string, Function[]>,
      on: function(event: string, listener: Function) {
        console.log(`[Adapter] Adding listener for ${event}`);
        if (!this._listeners[event]) {
          this._listeners[event] = [];
        }
        this._listeners[event].push(listener);
        return this;
      },
    };
    
    // Create transport with message endpoint as the target for client->server messages
    const transport = new SSEServerTransport("/message", honoResponseAdapter as unknown as ServerResponse);
    let sessionId: string;

    // Keep the connection alive
    return new Response(
      new ReadableStream({
        start(controller) {
          console.log("[SSE] Stream started");
          
          // Add adapter method to forward data from the adapter to the stream
          const adapter = transport['res'] as any;
          const originalWrite = adapter.write;
          adapter.write = function(chunk: string) {
            console.log(`[Stream Relay] Received chunk of length ${chunk.length}, forwarding to client`);
            controller.enqueue(chunk);
            return originalWrite.call(this, chunk);
          };

          // Set up transport event handlers
          transport.onmessage = (message) => {
            console.log(`[SSE] Server message:`, message);
            controller.enqueue(`data: ${JSON.stringify(message)}\n\n`);
          };
          
          transport.onerror = (error) => {
            console.error(`[SSE] Transport error:`, error);
            controller.error(error);
          };

          // Connect transport to server and store it
          server.connect(transport).then(() => {
            sessionId = transport.sessionId;
            activeTransports.set(sessionId, transport);
            
            // Send endpoint event with session ID
            const endpointUrl = `/message?sessionId=${sessionId}`;
            controller.enqueue(`event: endpoint\ndata: ${endpointUrl}\n\n`);
            
            // Send initial connected event
            controller.enqueue('event: connected\ndata: {"status":"connected"}\n\n');
          }).catch(error => {
            console.error(`[SSE] Connection error:`, error);
            controller.error(error);
          });
          
          // Set up keep-alive ping
          const pingInterval = setInterval(() => {
            try {
              console.log(`[SSE] Sending ping`);
              controller.enqueue(`event: ping\ndata: ${Date.now()}\n\n`);
            } catch (err) {
              console.error(`[SSE] Ping error:`, err);
              clearInterval(pingInterval);
            }
          }, 15000);
          
          // Handle client disconnect
          c.req.raw.signal.addEventListener('abort', () => {
            console.log(`[SSE] Client disconnected, cleaning up session ${sessionId}`);
            clearInterval(pingInterval);
            if (sessionId) {
              // Just remove the transport from our map
              activeTransports.delete(sessionId);
              // Don't call server.disconnect() as it's not a function on the server instance
              // Instead, we'll just clean up the transport
              try {
                // Notify any listeners that might be attached to the transport
                if (transport.onerror) {
                  transport.onerror(new Error('Client disconnected'));
                }
              } catch (err) {
                console.error(`[SSE] Error during cleanup:`, err);
              }
            }
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

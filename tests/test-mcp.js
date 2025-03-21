#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to your MCP server executable
const mcpServerPath = path.resolve(__dirname, '../dist/index.cjs');

// Environment variables
const env = {
  ...process.env,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GITHUB_USERNAME: process.env.GITHUB_USERNAME
};

// Validate required environment variables
if (!env.GITHUB_TOKEN) {
  console.log("Error: GITHUB_TOKEN environment variable is required");
  process.exit(1);
}

if (!env.OPENAI_API_KEY) {
  console.log("Error: OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

if (!env.GITHUB_USERNAME) {
  console.log("Error: GITHUB_USERNAME environment variable is required");
  process.exit(1);
}

// Spawn the MCP server
const mcp = spawn('node', [mcpServerPath], { env });

// Listen for stdout (MCP responses)
mcp.stdout.on('data', (data) => {
  const message = data.toString().trim();
  try {
    // Try to parse JSON
    const jsonMessage = JSON.parse(message);
    console.log('Received MCP response:', JSON.stringify(jsonMessage, null, 2));
    
    // If this is the ListTools response, send a CallTool request
    if (jsonMessage.result && jsonMessage.result.tools) {
      console.log('Tools available, sending CallTool request...');
      sendCallToolRequest();
    }
  } catch (e) {
    // Not JSON, just log the message
    console.log('MCP server stdout:', message);
  }
});

// Listen for stderr (console.log messages from the MCP server)
mcp.stderr.on('data', (data) => {
  console.log('MCP server stderr:', data.toString().trim());
});

// When the MCP server exits
mcp.on('close', (code) => {
  console.log(`MCP server exited with code ${code}`);
});

// Send a JSON-RPC message to the MCP server
function sendMessage(message) {
  mcp.stdin.write(JSON.stringify(message) + '\n');
}

// Wait for server to start then send ListTools
setTimeout(() => {
  console.log('Sending ListTools request...');
  sendMessage({
    jsonrpc: '2.0',
    id: '1',
    method: 'listTools',
    params: {}
  });
}, 1000);

// Send a CallTool request
function sendCallToolRequest() {
  console.log('Sending CallTool request for github_enhance_resume_with_project...');
  sendMessage({
    jsonrpc: '2.0',
    id: '2',
    method: 'callTool',
    params: {
      name: 'github_enhance_resume_with_project',
      arguments: {
        directory: process.cwd()
      }
    }
  });
}

// Exit gracefully
process.on('SIGINT', () => {
  console.log('Exiting...');
  mcp.kill();
  process.exit(0);
});

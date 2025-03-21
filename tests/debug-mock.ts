import { ResumeEnhancer } from "../src/resume-enhancer.js";
import { CodebaseAnalysisResult } from "../src/codebase.js";
import { Resume } from "../src/types.js";
import { ResumeUpdate } from "../src/schemas.js";

// Mock OpenAI service
class MockOpenAIService {
  async generateResumeEnhancement(): Promise<ResumeUpdate> {
    return {
      newProject: {
        name: "JSON Resume MCP Server",
        startDate: "2024-12",
        endDate: "Present",
        description: "Developed a Model Context Protocol (MCP) server that enhances AI assistants with the ability to update a JSON Resume by analyzing coding projects.",
        highlights: [
          "Implemented TypeScript/Node.js MCP server integration",
          "Created GitHub API integration for resume storage and retrieval",
          "Developed OpenAI function calling for intelligent resume enhancement",
          "Implemented codebase analysis tools for skills and project detection"
        ],
        url: "https://github.com/jsonresume/mcp-starter"
      },
      newSkills: [
        {
          name: "TypeScript",
          level: "Advanced",
          keywords: ["Node.js", "Static Typing", "ES6+"]
        },
        {
          name: "Model Context Protocol (MCP)",
          level: "Intermediate",
          keywords: ["AI Integration", "Function Calling", "API Design"]
        },
        {
          name: "GitHub API",
          level: "Intermediate",
          keywords: ["OAuth", "REST API", "Gist Management"]
        }
      ],
      changes: [
        "Added JSON Resume MCP Server project",
        "Added TypeScript skill with Node.js, Static Typing, ES6+ keywords",
        "Added Model Context Protocol (MCP) skill with AI Integration, Function Calling, API Design keywords",
        "Added GitHub API skill with OAuth, REST API, Gist Management keywords"
      ]
    };
  }

  async enhanceResume(resume: Resume, update: ResumeUpdate): Promise<Resume> {
    const result = { ...resume };
    
    // Add the new project
    result.projects = [...(result.projects || []), update.newProject];
    
    // Add new skills
    result.skills = [...(result.skills || []), ...update.newSkills];
    
    return result;
  }

  async generateUpdateSummary(changes: string[]): Promise<string> {
    return "Your resume has been enhanced with a new JSON Resume MCP Server project and skills in TypeScript, Model Context Protocol (MCP), and GitHub API.";
  }
}

async function testEnhanceWithMock() {
  try {
    // Create a sample resume
    const resume: Resume = {
      basics: {
        name: "Test User",
        label: "Software Developer",
        email: "test@example.com"
      },
      skills: [],
      projects: []
    };
    
    // Create a sample codebase analysis
    const codebaseAnalysis: CodebaseAnalysisResult = {
      repoName: "mcp-server",
      languages: {
        "TypeScript": 80,
        "Markdown": 15,
        "JSON": 5
      },
      fileCount: 10,
      recentCommits: [],
      technologies: ["Node.js", "TypeScript", "GitHub API", "OpenAI"],
      summary: "A Model Context Protocol server for enhancing resumes"
    };
    
    // Create the resume enhancer with the mock OpenAI service
    const mockOpenAIService = new MockOpenAIService();
    const resumeEnhancer = new ResumeEnhancer(mockOpenAIService as any);
    
    console.log("Enhancing resume with mock data...");
    const result = await resumeEnhancer.enhanceWithCurrentProject(
      resume,
      codebaseAnalysis,
      "testuser"
    );
    
    console.log("Enhancement successful!");
    console.log("Summary:", result.summary);
    console.log("Added skills:", result.changes.addedSkills.join(", "));
    console.log("Updated projects:", result.changes.updatedProjects.join(", "));
    
    return result;
  } catch (error) {
    console.log("Error in mock test:", error);
    throw error;
  }
}

testEnhanceWithMock()
  .then(result => {
    console.log("Test completed successfully");
    process.exit(0);
  })
  .catch(error => {
    console.log("Test failed:", error);
    process.exit(1);
  });

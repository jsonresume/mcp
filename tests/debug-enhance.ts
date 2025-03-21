import { GitHubService } from "../src/github.js";
import { OpenAIService } from "../src/openai.js";
import { CodebaseAnalyzer } from "../src/codebase.js";
import { ResumeEnhancer } from "../src/resume-enhancer.js";
import { Resume } from "../src/types.js";

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

async function main() {
  console.log("Starting resume enhancement test...");
  
  try {
    // Validate environment variables
    if (!GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    if (!GITHUB_USERNAME) {
      throw new Error("GITHUB_USERNAME environment variable is required");
    }
    
    // Initialize services
    console.log("Initializing services...");
    const githubService = new GitHubService(GITHUB_TOKEN, GITHUB_USERNAME);
    const openaiService = new OpenAIService(OPENAI_API_KEY);
    const codebaseAnalyzer = new CodebaseAnalyzer(process.cwd());
    const resumeEnhancer = new ResumeEnhancer(openaiService);
    
    // Get or create a sample resume
    console.log("Getting sample resume...");
    const sampleResume: Resume = {
      basics: {
        name: "Test User",
        label: "Software Developer",
        email: "test@example.com"
      },
      skills: [],
      projects: []
    };
    
    // Analyze the codebase
    console.log("Analyzing codebase...");
    const codebaseAnalysis = await codebaseAnalyzer.analyze();
    console.log("Codebase analysis complete:", {
      repoName: codebaseAnalysis.repoName,
      languages: Object.keys(codebaseAnalysis.languages || {}).join(", "),
      technologies: (codebaseAnalysis.technologies || []).join(", ")
    });
    
    // Enhance the resume
    console.log("Enhancing resume...");
    const enhancementResult = await resumeEnhancer.enhanceWithCurrentProject(
      sampleResume,
      codebaseAnalysis,
      GITHUB_USERNAME
    );
    
    console.log("Enhancement complete!");
    console.log("Summary:", enhancementResult.summary);
    console.log("Added skills:", enhancementResult.changes.addedSkills.join(", "));
    console.log("Project name:", enhancementResult.changes.updatedProjects[0]);
    
    return enhancementResult;
  } catch (error) {
    console.log("Error during enhancement process:", error);
    throw error;
  }
}

main().catch(error => {
  console.log("Fatal error:", error);
  process.exit(1);
});

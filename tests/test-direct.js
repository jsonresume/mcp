#!/usr/bin/env node

import { GitHubService } from "./src/github.ts";
import { OpenAIService } from "./src/openai.ts";
import { CodebaseAnalyzer } from "./src/codebase.ts";
import { ResumeEnhancer } from "./src/resume-enhancer.ts";

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

// Initialize services
async function init() {
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
    
    console.log("Initializing services...");
    const githubService = new GitHubService(GITHUB_TOKEN, GITHUB_USERNAME);
    const openaiService = new OpenAIService(OPENAI_API_KEY);
    const codebaseAnalyzer = new CodebaseAnalyzer(process.cwd());
    const resumeEnhancer = new ResumeEnhancer(openaiService);
    
    console.log("Services initialized successfully");
    
    return { githubService, openaiService, codebaseAnalyzer, resumeEnhancer };
  } catch (error) {
    console.log("Error initializing services:", error);
    process.exit(1);
  }
}

async function enhanceResumeWithProject() {
  try {
    console.log("Starting resume enhancement with current project...");
    
    const { githubService, openaiService, codebaseAnalyzer, resumeEnhancer } = await init();
    
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
    const codebaseAnalysis = await codebaseAnalyzer.analyze();
    console.log("Codebase analysis completed:", JSON.stringify({
      repoName: codebaseAnalysis.repoName,
      languages: Object.keys(codebaseAnalysis.languages),
      technologies: codebaseAnalysis.technologies
    }));
    
    // Step 3: Enhance the resume with the current project
    console.log("Enhancing resume with current project...");
    const { updatedResume, changes, summary, userMessage, resumeLink } = await resumeEnhancer.enhanceWithCurrentProject(
      resume,
      codebaseAnalysis,
      GITHUB_USERNAME
    );
    
    console.log("Resume enhancement completed successfully");
    console.log("Summary:", summary);
    
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
    };
  } catch (error) {
    console.log("Error enhancing resume with project:", error);
    throw error;
  }
}

enhanceResumeWithProject()
  .then(result => {
    console.log("Result:", JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(error => {
    console.log("Fatal error:", error);
    process.exit(1);
  });

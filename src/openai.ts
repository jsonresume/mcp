import OpenAI from "openai";
import { Resume } from "./types.js";
import { CodebaseAnalysisResult } from "./codebase.js";
import { resumeUpdateSchema, ResumeUpdate } from "./schemas.js";
import { z } from "zod";

export class OpenAIService {
  private client: OpenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Generate a new project and skills based on codebase analysis
   */
  async generateResumeEnhancement(
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<ResumeUpdate> {
    try {
      console.log("Preparing OpenAI API call for resume enhancement...");
      
      // Call OpenAI API with function calling
      const response = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content:
              "You are a professional technical resume writer that creates high-quality JSON Resume compatible project entries and skills based on codebase analysis. Focus on capturing the essence and significance of the project, not just technical details.\n\n" +
              "Guidelines:\n" +
              "- Begin by clearly explaining what the project DOES and its PURPOSE - this is the most important part\n" +
              "- Focus on the problem it solves and value it provides to users or stakeholders\n" +
              "- Then mention key technical achievements and architectural decisions\n" +
              "- Create professional, substantive descriptions that highlight business value\n" +
              "- Avoid trivial details like file counts or minor technologies\n" +
              "- For dates, use YYYY-MM-DD format and ensure they are realistic (not in the future)\n" +
              "- For ongoing projects, omit the endDate field entirely\n" +
              "- Only include skills that are substantive and resume-worthy\n" +
              "- Group skills by category when possible\n" +
              "- Prioritize quality over quantity in skills and descriptions",
          },
          { 
            role: "user", 
            content: `Based on this codebase analysis, generate a single project entry and relevant skills for a resume that focuses first on WHAT the project does and WHY it matters, then how it was implemented:

${codebaseAnalysis.readmeContent ? `README.md Content:\n${codebaseAnalysis.readmeContent}\n\n` : ''}

Codebase Analysis:\n${JSON.stringify(codebaseAnalysis, null, 2)}` 
          },
        ],
        functions: [
          {
            name: "create_resume_update",
            description: "Create a new project entry and skills based on codebase analysis",
            parameters: {
              type: "object",
              properties: {
                newProject: {
                  type: "object",
                  properties: {
                    name: { 
                      type: "string",
                      description: "Professional project name"
                    },
                    startDate: { 
                      type: "string", 
                      description: "Project start date in YYYY-MM-DD or YYYY-MM format (must be a realistic date, not in the future)"
                    },
                    endDate: { 
                      type: "string", 
                      description: "Project end date in YYYY-MM-DD or YYYY-MM format. OMIT THIS FIELD ENTIRELY for ongoing projects - do not use 'Present' or future dates."
                    },
                    description: { 
                      type: "string",
                      description: "Professional project description that STARTS by clearly explaining what the project does and why it matters. Begin with its purpose and function, then mention key technologies and implementation details. (60-100 words recommended)"
                    },
                    highlights: { 
                      type: "array",
                      items: { type: "string" },
                      description: "Bullet points highlighting key achievements and technologies that demonstrate significant impact"
                    },
                    url: { 
                      type: "string",
                      description: "Project URL" 
                    },
                    roles: { 
                      type: "array", 
                      items: { type: "string" },
                      description: "Roles held during the project"
                    },
                    entity: { 
                      type: "string",
                      description: "Organization name associated with the project"
                    },
                    type: { 
                      type: "string",
                      description: "Type of project (application, library, etc.)"
                    }
                  },
                  required: ["name", "startDate", "description"]
                },
                newSkills: {
                  type: "array",
                  description: "Only include substantive, resume-worthy skills that demonstrate significant expertise",
                  items: {
                    type: "object",
                    properties: {
                      name: { 
                        type: "string",
                        description: "Professional skill name"
                      },
                      level: { 
                        type: "string",
                        description: "Skill proficiency level"
                      },
                      keywords: { 
                        type: "array",
                        items: { type: "string" },
                        description: "Related keywords for this skill"
                      },
                      category: {
                        type: "string",
                        description: "Skill category for grouping (e.g., 'Programming Languages', 'Frameworks', 'Tools')"
                      }
                    },
                    required: ["name"]
                  }
                },
                changes: {
                  type: "array",
                  items: { type: "string" },
                  description: "Summary of changes made to the resume"
                }
              },
              required: ["newProject", "newSkills", "changes"]
            }
          }
        ],
        function_call: { name: "create_resume_update" }
      });

      console.log("Received response from OpenAI API");
      
      const functionCall = response.choices[0]?.message?.function_call;
      if (!functionCall?.arguments) {
        console.log("Error: No function call arguments in OpenAI response");
        throw new Error("No function call arguments received from OpenAI");
      }

      // Parse and validate the response
      console.log("Parsing and validating OpenAI response...");
      try {
        const result = JSON.parse(functionCall.arguments);
        const validated = resumeUpdateSchema.parse(result);
        console.log("Successfully validated schema");
        return validated;
      } catch (parseError) {
        console.log("Error parsing OpenAI response:", 
          parseError instanceof SyntaxError ? "JSON parse error" : 
          parseError instanceof z.ZodError ? "Schema validation error" : 
          "Unknown error"
        );
        console.log("Raw function call arguments:", functionCall.arguments.substring(0, 200) + "...");
        throw parseError;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.log("Schema validation error:", error.errors);
      } else if (error instanceof SyntaxError) {
        console.log("JSON parsing error:", error.message);
      } else if (error instanceof Error) {
        console.log("OpenAI API error:", error.message);
        console.log("Error details:", error);
      } else {
        console.log("Unknown error:", error);
      }
      throw error;
    }
  }

  /**
   * Add only new project and skills to a resume without modifying any existing content
   */
  async enhanceResume(resume: Resume, update: ResumeUpdate): Promise<Resume> {
    const result = JSON.parse(JSON.stringify(resume)) as Resume;
    
    // Store the _gistId separately so we can add it back later
    const gistId = (result as any)._gistId;
    
    // Add the new project if it doesn't already exist
    const existingProjects = new Set(
      (result.projects || []).map(project => project.name.toLowerCase())
    );
    
    if (update.newProject && !existingProjects.has(update.newProject.name.toLowerCase())) {
      result.projects = [...(result.projects || []), update.newProject];
    }
    
    // Add new skills if they don't already exist
    const existingSkills = new Set(
      (result.skills || []).map(skill => 
        typeof skill === 'string' ? skill.toLowerCase() : skill.name.toLowerCase()
      )
    );
    
    const newSkills = update.newSkills.filter(skill => 
      !existingSkills.has(skill.name.toLowerCase())
    );
    
    if (newSkills.length > 0) {
      result.skills = [...(result.skills || []), ...newSkills];
    }
    
    // Add back the _gistId if it existed
    if (gistId) {
      (result as any)._gistId = gistId;
    }
    
    return result;
  }

  /**
   * Generate a summary of updates made to the resume
   */
  async generateUpdateSummary(changes: string[]): Promise<string> {
    try {
      console.log("Generating update summary...");
      
      // Call OpenAI API to generate a summary
      const response = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that creates concise summaries of resume updates."
          },
          {
            role: "user",
            content: `Create a brief, professional summary of these changes made to a resume:\n${changes.join('\n')}`
          }
        ],
        max_tokens: 150
      });
      
      const summary = response.choices[0]?.message?.content || "Resume updated with new project details and skills.";
      return summary;
    } catch (error) {
      console.log("Error generating update summary:", error);
      return "Resume updated with new project details and skills.";
    }
  }
}

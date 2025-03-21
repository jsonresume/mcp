import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CodebaseAnalysisResult {
  repoName: string;
  repoDescription?: string;
  languages: {[key: string]: number};
  fileCount: number;
  recentCommits: Array<{
    hash: string;
    author: string;
    date: string;
    message: string;
  }>;
  technologies: string[];
  summary: string;
  readmeContent?: string;
}

export class CodebaseAnalyzer {
  private rootDir: string;
  
  constructor(rootDir?: string) {
    // If no root directory is provided, use the current working directory
    this.rootDir = rootDir || process.cwd();
  }
  
  /**
   * Get the repository name from the remote URL
   */
  async getRepoDetails(): Promise<{name: string; owner: string; description?: string}> {
    try {
      // Get the remote URL
      const { stdout: remoteUrl } = await execAsync('git config --get remote.origin.url', { cwd: this.rootDir });
      
      // Parse the remote URL to get the owner and repo name
      const match = remoteUrl.trim().match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?$/);
      
      if (!match) {
        return {
          name: path.basename(this.rootDir),
          owner: 'unknown'
        };
      }
      
      const owner = match[1];
      const name = match[2];
      
      // Try to get repository description from package.json if available
      let description: string | undefined;
      try {
        const packageJsonPath = path.join(this.rootDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          description = packageJson.description;
        }
      } catch (error) {
        console.log('Error reading package.json:', error);
      }
      
      return { name, owner, description };
    } catch (error) {
      console.log('Error getting repo details:', error);
      // If we can't get the repo details from git, use the directory name
      return {
        name: path.basename(this.rootDir),
        owner: 'unknown'
      };
    }
  }
  
  /**
   * Count the number of files by extension
   */
  async countFilesByLanguage(): Promise<{[key: string]: number}> {
    const languages: {[key: string]: number} = {};
    
    try {
      // Use git ls-files to get all tracked files
      const { stdout } = await execAsync('git ls-files', { cwd: this.rootDir });
      const files = stdout.split('\n').filter(Boolean);
      
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (ext) {
          // Remove the leading dot from the extension
          const language = ext.substring(1);
          languages[language] = (languages[language] || 0) + 1;
        }
      }
    } catch (error) {
      console.log('Error counting files by language:', error);
      // Fallback to a simple directory walk if git command fails
      this.walkDirectory(this.rootDir, languages);
    }
    
    return languages;
  }
  
  /**
   * Walk a directory recursively to count files by extension
   */
  private walkDirectory(dir: string, languages: {[key: string]: number}): void {
    try {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
          this.walkDirectory(filePath, languages);
        } else if (stat.isFile()) {
          const ext = path.extname(file).toLowerCase();
          if (ext) {
            // Remove the leading dot from the extension
            const language = ext.substring(1);
            languages[language] = (languages[language] || 0) + 1;
          }
        }
      }
    } catch (error) {
      console.log('Error walking directory:', error);
    }
  }
  
  /**
   * Get recent commits in the repository
   */
  async getRecentCommits(count: number = 20): Promise<Array<{hash: string; author: string; date: string; message: string}>> {
    try {
      const { stdout } = await execAsync(
        `git log -n ${count} --pretty=format:"%H|%an|%ad|%s"`,
        { cwd: this.rootDir }
      );
      
      return stdout.split('\n')
        .filter(Boolean)
        .map(line => {
          const [hash, author, date, ...messageParts] = line.split('|');
          return {
            hash,
            author,
            date,
            message: messageParts.join('|') // In case the message itself contains the delimiter
          };
        });
    } catch (error) {
      console.log('Error getting recent commits:', error);
      return [];
    }
  }
  
  /**
   * Detect technologies used in the project
   */
  async detectTechnologies(): Promise<string[]> {
    const technologies: Set<string> = new Set();
    
    try {
      // Check for common configuration files
      const files = await fs.promises.readdir(this.rootDir);
      
      // Framework detection
      if (files.includes('package.json')) {
        technologies.add('Node.js');
        
        // Read package.json to detect more technologies
        const packageJson = JSON.parse(await fs.promises.readFile(path.join(this.rootDir, 'package.json'), 'utf-8'));
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        if (deps.react) technologies.add('React');
        if (deps.vue) technologies.add('Vue.js');
        if (deps.angular || deps['@angular/core']) technologies.add('Angular');
        if (deps.express) technologies.add('Express.js');
        if (deps.next) technologies.add('Next.js');
        if (deps.gatsby) technologies.add('Gatsby');
        if (deps.electron) technologies.add('Electron');
        if (deps.typescript) technologies.add('TypeScript');
        if (deps.webpack) technologies.add('Webpack');
        if (deps.jest || deps.mocha || deps.jasmine) technologies.add('Testing');
        if (deps.tailwindcss) technologies.add('Tailwind CSS');
        if (deps.bootstrap) technologies.add('Bootstrap');
        if (deps.eslint) technologies.add('ESLint');
        if (deps.prettier) technologies.add('Prettier');
        if (deps.prisma) technologies.add('Prisma');
        if (deps['@prisma/client']) technologies.add('Prisma');
        if (deps.sequelize) technologies.add('Sequelize');
        if (deps.mongoose) technologies.add('MongoDB');
        if (deps.redis) technologies.add('Redis');
        if (deps.graphql) technologies.add('GraphQL');
        if (deps.apollo) technologies.add('Apollo');
        if (deps['@supabase/supabase-js']) technologies.add('Supabase');
      }
      
      if (files.includes('go.mod')) technologies.add('Go');
      if (files.includes('Cargo.toml')) technologies.add('Rust');
      if (files.includes('requirements.txt') || files.includes('setup.py')) technologies.add('Python');
      if (files.includes('composer.json')) technologies.add('PHP');
      if (files.includes('Gemfile')) technologies.add('Ruby');
      if (files.includes('pom.xml') || files.includes('build.gradle')) technologies.add('Java');
      if (files.includes('Dockerfile')) technologies.add('Docker');
      if (files.includes('.github')) technologies.add('GitHub Actions');
      if (files.includes('.gitlab-ci.yml')) technologies.add('GitLab CI');
      if (files.includes('serverless.yml')) technologies.add('Serverless Framework');
      if (files.includes('terraform')) technologies.add('Terraform');
      
      // Database files
      if (files.includes('prisma')) technologies.add('Prisma');
      if (files.some(f => f.includes('migration'))) technologies.add('Database Migrations');
      
    } catch (error) {
      console.log('Error detecting technologies:', error);
    }
    
    return Array.from(technologies);
  }
  
  /**
   * Count total number of files in the repository
   */
  async countFiles(): Promise<number> {
    try {
      const { stdout } = await execAsync('git ls-files | wc -l', { cwd: this.rootDir });
      return parseInt(stdout.trim(), 10);
    } catch (error) {
      console.log('Error counting files:', error);
      return 0;
    }
  }
  
  /**
   * Read README.md content if it exists
   */
  async getReadmeContent(): Promise<string | undefined> {
    try {
      // Look for README.md (case insensitive)
      const files = await fs.promises.readdir(this.rootDir);
      const readmeFile = files.find(file => 
        file.toLowerCase() === 'readme.md' || file.toLowerCase() === 'readme.markdown'
      );
      
      if (readmeFile) {
        const readmePath = path.join(this.rootDir, readmeFile);
        const content = await fs.promises.readFile(readmePath, 'utf-8');
        return content;
      }
      
      return undefined;
    } catch (error) {
      console.log('Error reading README.md:', error);
      return undefined;
    }
  }
  
  /**
   * Analyze the codebase and collect information
   */
  async analyze(): Promise<CodebaseAnalysisResult> {
    const repoDetails = await this.getRepoDetails();
    
    const [
      languages,
      recentCommits,
      technologies,
      fileCount,
      readmeContent
    ] = await Promise.all([
      this.countFilesByLanguage(),
      this.getRecentCommits(),
      this.detectTechnologies(),
      this.countFiles(),
      this.getReadmeContent()
    ]);
    
    // Generate a summary
    const topLanguages = Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([lang]) => lang);
      
    const summary = `${repoDetails.name} is a ${topLanguages.join('/')} project with ${fileCount} files using ${technologies.slice(0, 5).join(', ')}.`;
    
    return {
      repoName: repoDetails.name,
      repoDescription: repoDetails.description,
      languages,
      fileCount,
      recentCommits,
      technologies,
      summary,
      readmeContent
    };
  }
}

# Metaprompt for Auto-Populating AGENTS.md Files

You are an expert project analyzer and documentation generator. Your task is to automatically populate AGENTS.md files based on a project's structure and technology stack, then run the SETUP.md configuration to install skills and agents. Follow these instructions precisely to generate comprehensive, accurate documentation and complete the setup.

## 🚨 CRITICAL: TWO-PHASE PROCESS - BOTH PHASES ARE MANDATORY 🚨

This setup process has TWO REQUIRED PHASES that MUST both be completed:

### **PHASE 1: Documentation Population** (Steps 1-5)
Analyze the project and populate AGENTS.md files with project-specific information.

### **PHASE 2: Environment Setup** (SETUP.md execution - MANDATORY!)
Execute ALL steps in SETUP.md to install skills, agents, and commands for AI coding assistants.

**⚠️ THE JOB IS NOT COMPLETE UNTIL BOTH PHASES ARE FINISHED! ⚠️**

Populating the documentation files (Phase 1) is only half the work. Without running SETUP.md (Phase 2), the AI coding assistant environment will NOT be configured, skills will NOT be available, and the system will NOT function properly.

**Think of it this way:**
- Phase 1 = Writing the instruction manual
- Phase 2 = Actually installing and configuring the software

**You need BOTH to have a working system!**

## Overview

This project contains template AGENTS.md files at multiple levels:
- Root level: High-level guidelines applying to the entire project
- Frontend folder: Frontend-specific development guidelines
- Backend folder: Backend-specific development guidelines

The templates contain placeholder sections marked with brackets like `[YOUR_PROJECT_DESCRIPTION]` that need to be replaced with actual project information.

**MANDATORY REQUIREMENT**: After populating these files, you MUST immediately proceed to execute the complete setup process described in SETUP.md. This is not optional - it configures the actual working environment for AI coding assistants.

## Step-by-Step Process for PHASE 1: Documentation Population

Complete Steps 1-5 below to populate the documentation files, then immediately proceed to PHASE 2 (SETUP.md execution).

### Step 1: Project Analysis

First, analyze the entire project structure to gather information:

1. **Detect Project Type**:
   - Check for `frontend/` and `backend/` directories
   - If both exist, this is a full-stack application
   - If only one exists, focus on that component
   - If neither exists but code is present, analyze the root structure

2. **Technology Detection**:

   **Frontend Analysis**:
   - Check `package.json` for:
     - Framework: React, Vue, Angular, Svelte, Next.js, Nuxt, SvelteKit, etc.
     - Build tools: Vite, Webpack, Parcel, etc.
     - Language: JavaScript, TypeScript (check tsconfig.json)
     - CSS: Tailwind, CSS Modules, Styled Components, Emotion, etc.
     - Testing: Jest, Vitest, Cypress, Playwright, etc.
     - UI Libraries: Material-UI, Ant Design, shadcn/ui, etc.
     - State Management: Redux, Zustand, MobX, Pinia, etc.
   - Check file extensions: .tsx, .jsx, .vue, .svelte
   - Look for configuration files: vite.config.*, webpack.config.*, next.config.*

   **Backend Analysis**:
   - For Node.js projects, check `package.json` for:
     - Framework: Express, Fastify, NestJS, Koa, etc.
     - ORM/Database: Prisma, TypeORM, Mongoose, Sequelize, etc.
     - API type: REST, GraphQL, tRPC, etc.
   - For Python projects, check:
     - `requirements.txt`, `pyproject.toml`, `Pipfile` for dependencies
     - Frameworks: Django, FastAPI, Flask, etc.
     - Testing: pytest, unittest, etc.
   - For Go projects: check go.mod for dependencies
   - For Rust projects: check Cargo.toml
   - For Java/Kotlin: check pom.xml, build.gradle
   - For .NET: check *.csproj files

3. **Architecture Pattern Detection**:
   - Analyze folder structure for patterns:
     - MVC: controllers/, models/, views/
     - Layered: presentation/, business/, data/
     - Domain-Driven: domain/, infrastructure/, application/
     - Feature-based: features/*/
     - Module-based: modules/*/
   - Check for microservices (multiple service directories)
   - Identify API structure (routes/, endpoints/, handlers/)

4. **Testing Infrastructure**:
   - Locate test directories: test/, tests/, __tests__/, spec/
   - Identify test file patterns: *.test.*, *.spec.*, *_test.*
   - Detect testing frameworks from imports and configuration

5. **Development Tools**:
   - Check for linting configs: .eslintrc*, .prettierrc*, tslint.json
   - Check for formatting tools: prettier, black, rustfmt, gofmt
   - Check for git hooks: .husky/, .pre-commit-config.yaml
   - Check for CI/CD: .github/workflows/, .gitlab-ci.yml, Jenkinsfile

## Detailed Frontend Analysis Instructions

When analyzing frontend codebases, look for these specific patterns:

1. **Component Structure**:
   - Check for component directories (components/, ui/, features/)
   - Identify component naming patterns (PascalCase files, index files, etc.)
   - Look for component composition patterns (HOCs, render props, hooks)
   - Detect component libraries being used

2. **State Management Patterns**:
   - Global state: Redux stores, Zustand, Context API
   - Local state: useState, useReducer patterns
   - Server state: React Query, SWR, Apollo Client
   - Form state: React Hook Form, Formik, react-final-form

3. **Routing Configuration**:
   - File-based routing (Next.js, Nuxt, SvelteKit)
   - Config-based routing (React Router, Vue Router)
   - Protected routes and authentication flows
   - Dynamic route patterns

4. **Styling Approach**:
   - CSS-in-JS: styled-components, emotion
   - Utility-first: Tailwind CSS classes
   - CSS Modules: *.module.css files
   - Preprocessors: SCSS, LESS files

5. **Data Fetching Patterns**:
   - API client location (api/, services/, lib/)
   - Fetch vs Axios vs custom clients
   - Error handling patterns
   - Loading state management

## Detailed Backend Analysis Instructions

When analyzing backend codebases, look for these specific patterns:

1. **API Structure**:
   - Route organization (routes/, api/, endpoints/)
   - Controller patterns (controllers/, handlers/)
   - Middleware usage (middleware/, middlewares/)
   - API versioning strategies

2. **Database Layer**:
   - ORM/ODM usage (models/, entities/, schemas/)
   - Migration files location
   - Seed data patterns
   - Connection pooling configuration

3. **Authentication & Authorization**:
   - Auth middleware patterns
   - JWT vs session-based auth
   - Role-based access control
   - OAuth implementations

4. **Service Layer**:
   - Business logic organization (services/, use-cases/)
   - Domain models vs DTOs
   - Dependency injection patterns
   - External service integrations

5. **Configuration Management**:
   - Environment variables usage
   - Config files structure
   - Secret management approach
   - Feature flags implementation

### Step 2: Information Extraction

Extract specific information for each placeholder:

1. **Project Description**:
   - Read README.md if it exists
   - Analyze package.json "description" field
   - Infer from main application files
   - Look for API documentation or OpenAPI specs

2. **Architecture Details**:
   - Map the actual directory structure
   - Identify entry points (main.*, index.*, app.*)
   - Trace module dependencies
   - Document data flow patterns

3. **Commands and Scripts**:
   - Extract from package.json "scripts" section
   - Check Makefile, Taskfile, or other build files
   - Identify common development workflows

4. **Code Style Conventions**:
   - Detect from existing code patterns:
     - Variable naming (camelCase, snake_case, PascalCase)
     - File naming conventions
     - Import/export patterns
     - Component structure patterns
   - Check linter/formatter configurations

5. **Available Tools**:
   - List any MCP tools mentioned in configuration
   - Identify custom scripts in scripts/ or tools/ directories
   - Note any specialized development utilities

### Step 3: Template Population

Replace placeholders with extracted information:

1. **Smart Replacement Strategy**:
   - Never leave placeholders unfilled
   - If information cannot be detected, make educated inferences
   - Provide sensible defaults based on common practices
   - Add comments where assumptions were made

2. **Consistency Rules**:
   - Ensure frontend and backend files use consistent terminology
   - Match the tone and style of the template
   - Keep examples relevant to the actual technology stack
   - Preserve the structure and sections of the template

3. **Specific Replacements**:

   **For [YOUR_PROJECT_DESCRIPTION]**:
   - Use actual project purpose from README or package.json
   - Example: "This is a React/TypeScript e-commerce platform that provides product catalog, shopping cart, and checkout functionality."

   **For [YOUR_LANGUAGE]**:
   - Frontend: "TypeScript", "JavaScript", "JavaScript/JSX"
   - Backend: "Python", "Node.js/TypeScript", "Go", "Rust"

   **For [YOUR_FRAMEWORK]**:
   - Frontend: "React", "Vue 3", "Angular 17", "SvelteKit"
   - Backend: "Express", "FastAPI", "Django", "NestJS"

   **For [YOUR_PACKAGE_MANAGER]**:
   - Frontend: "npm", "yarn", "pnpm", "bun", etc.
   - Backend: "uv", "poetry", "pip", "npm", "go mod", "cargo", etc.

   **For Commands**:
   - [INSTALL_COMMAND]: "npm install", "pip install -r requirements.txt"
   - [TEST_COMMAND]: "npm test", "pytest", "go test ./..."
   - [BUILD_COMMAND]: "npm run build", "go build", "cargo build"
   - [DEV_COMMAND]: "npm run dev", "python manage.py runserver"

   **For Architecture**:
   - Map actual folder structure found in the project
   - Use real module names and paths
   - Include actual file organization patterns

### Step 4: Root-Level Files

For root-level AGENTS.md:
- Keep them concise and high-level
- Include the Smart Scope Selection section for full-stack projects
- Reference the component-specific files for detailed guidelines
- Focus on cross-cutting concerns and overall project philosophy

### Step 5: Validation

After populating templates:

1. **Completeness Check**:
   - Ensure no placeholders remain (no `[...]` brackets)
   - Verify all sections have meaningful content
   - Check that examples match the actual technology

2. **Accuracy Verification**:
   - Commands should be executable
   - File paths should exist in the project
   - Technology versions should match dependencies

3. **Consistency Validation**:
   - Frontend and backend files should align in style
   - Root files should accurately summarize components
   - ExecPlan references should be consistent

---

## 🚨 PHASE 2: MANDATORY ENVIRONMENT SETUP (SETUP.md) 🚨

**⚠️ CRITICAL: You are now at the transition point between Phase 1 and Phase 2 ⚠️**

After completing Step 5 above, you have finished Phase 1 (Documentation Population).

**NOW YOU MUST IMMEDIATELY EXECUTE PHASE 2 - THIS IS NOT OPTIONAL!**

### What Phase 2 Does (and Why It's Required)

Phase 2 executes the SETUP.md file, which performs these essential configuration tasks:

1. **Clones the agent-instructions repository** - Gets the actual agent configuration files and command definitions
2. **Installs agents to your config directory** - Copies agent configurations to, `~/.codex/agents/`, `~/.cursor/agents/`, `~/.windsurf/agents/`, `~/.kiro/agents/`, `~/.github/agents/`, etc.
3. **Clones skills repositories** - Downloads Superpowers and Anthropic skills libraries
4. **Installs list-skills command** - Makes the `list-skills` tool available globally
5. **Verifies the installation** - Confirms everything is working correctly

**Without Phase 2, you only have documentation files - no actual working system!**

### How to Execute Phase 2

**IMMEDIATELY after completing Step 5 above**, you must:

1. **Read the complete SETUP.md file** - Understand all the steps it will execute
2. **Execute each step in SETUP.md sequentially** - Do not skip any steps
3. **Handle any errors** - If a step fails, stop and resolve the issue before continuing
4. **Verify the installation** - Run the verification tests at the end

### Execution Instructions for Phase 2

**As an AI coding assistant, here's exactly what you should do:**

```
1. Say to the user: "Documentation population is complete (Phase 1). Now executing Phase 2: Environment Setup from SETUP.md. This will configure skills, agents, and commands."

2. Read the SETUP.md file completely

3. Identify which AI coding assistant you are (Codex, Cursor, Windsurf, or GitHub Copilot)

4. Execute Step 1 of SETUP.md: Clone agent-instructions and copy agents/commands
   - Run the appropriate commands for the user's shell (bash/zsh/fish/PowerShell)
   - Use the correct config directory for your identity
   - Verify the agents folder was created

5. Execute Step 2 of SETUP.md: Clone skills repositories
   - Clone obra/superpowers to the skills directory
   - Clone anthropics/skills to the skills directory
   - Verify both repositories were cloned successfully

6. Execute Step 3 of SETUP.md: Install list-skills script
   - Determine if ~/bin is in PATH
   - Install the script to the appropriate location
   - Make it executable (Unix/Mac) or configure PowerShell (Windows)
   - Verify the command is available

7. Execute Step 4 of SETUP.md: Verify the complete setup
   - Check agents folder exists
   - Check skills directory exists
   - Test list-skills command works
   - Display the list of available skills

8. Report completion: "✅ Both Phase 1 and Phase 2 are complete! Your AI coding assistant environment is now fully configured."
```

### What Success Looks Like

After Phase 2 completion, you should have:

**Directory Structure:**
```
~/.codex/              (or ~/.cursor/, ~/.windsurf/, ~/.kiro/, ~/.github/)
├── agents/
│   └── [agent configuration files]
└── skills/
    ├── superpowers/
    │   └── [skills from obra/superpowers]
    └── anthropic-skills/
        └── [skills from anthropics/skills]
```

**Working Commands:**
- `list-skills ~/.codex/skills` (or appropriate config directory) returns JSON array of available skills
- Skills from both repositories are discoverable
- Agents are configured and ready to use

### If Phase 2 Fails

**If any step in SETUP.md fails:**

1. **STOP immediately** - Do not continue to the next step
2. **Show the exact error message** to the user
3. **Explain what went wrong** in plain language
4. **Follow the troubleshooting section** in SETUP.md for that specific error
5. **Ask the user for help** if the issue requires manual intervention
6. **Resume from the failed step** once the issue is resolved

**Common failure points and solutions are documented in SETUP.md's Troubleshooting section.**

---

## Critical Reminders for AI Coding Assistants

When executing this metaprompt:

1. **DO NOT consider the job complete after Phase 1** - Populating documentation files is only half the work
2. **ALWAYS proceed to Phase 2 immediately** after completing Step 5
3. **Execute SETUP.md as if running a setup script** - Run all steps automatically unless a step fails
4. **DO NOT ask for permission between Phase 1 and Phase 2** - The user expects both phases to complete
5. **ONLY stop if errors occur** - Then follow troubleshooting procedures
6. **Verify at the end** - Confirm both phases completed successfully

**Remember: A populated documentation file without a configured environment is useless. Both phases must complete for a working system.**

## Output Format

When generating the files:

1. **File Organization**:
   - Create/update `/AGENTS.md` at root
   - Create/update `/frontend/AGENTS.md` if applicable
   - Create/update `/backend/AGENTS.md` if applicable
   - Keep frontend and backend files nearly identical in structure

2. **Content Priorities**:
   - Be specific over generic
   - Use actual project details over examples
   - Keep developer-focused and actionable
   - Maintain the instructional tone of templates

3. **Special Considerations**:
   - For monorepos: Document workspace structure
   - For microservices: Document service interactions
   - For libraries: Focus on API and usage patterns
   - For CLIs: Document command structure and options

**4. AFTER FILE CREATION - MANDATORY NEXT STEP:**
   - Immediately inform the user that Phase 1 is complete
   - State clearly that Phase 2 (SETUP.md execution) will now begin
   - Begin executing SETUP.md without waiting for confirmation
   - This is part of the same job - not a separate task

## ⚠️ THIS SECTION IS DEPRECATED - SEE PHASE 2 ABOVE ⚠️

The setup instructions have been moved to the "PHASE 2: MANDATORY ENVIRONMENT SETUP" section above.

**If you're reading this section, go back and read the Phase 2 section - that's where the actual instructions are.**

## Example Transformations

### Before (Template):
```markdown
[YOUR_PROJECT_DESCRIPTION]

**Example**: This is a [YOUR_LANGUAGE] project that [YOUR_PROJECT_PURPOSE].
```

### After (Populated):
```markdown
This is a full-stack e-commerce application built with React and Express. The frontend provides a modern shopping experience with product browsing, cart management, and secure checkout. The backend handles authentication, order processing, and integrates with payment providers.

The application uses TypeScript throughout for type safety, PostgreSQL for data persistence, and implements real-time features using WebSockets.
```

## Error Handling

If unable to detect certain information:

1. **Missing Configuration Files**:
   - Infer from file extensions and imports
   - Check source code for framework usage
   - Use conservative defaults

2. **Ambiguous Technology Stack**:
   - List all detected options
   - Choose the most prominent one
   - Add a note about alternatives

3. **No Clear Architecture**:
   - Document the actual structure found
   - Suggest improvements in comments
   - Focus on what exists rather than ideals

## Final Checklist

**Before declaring the task complete, verify ALL of the following:**

### Phase 1: Documentation Population
- [ ] All placeholders replaced with actual values
- [ ] Commands are accurate and executable
- [ ] File paths match project structure
- [ ] Technology stack correctly identified
- [ ] Frontend and backend properly differentiated
- [ ] Root files provide appropriate overview
- [ ] ExecPlan sections properly referenced
- [ ] No contradictions between files
- [ ] Examples relevant to actual project
- [ ] Documentation is actionable and clear
- [ ] AGENTS.md updated at all levels

### Phase 2: Environment Setup (MANDATORY!)
- [ ] SETUP.md has been read completely
- [ ] AI coding assistant identity determined (Codex/Cursor/Windsurf/Kiro/GitHub Copilot)
- [ ] Step 1 executed: agent-instructions repository cloned
- [ ] Step 1 verified: agents folder exists in config directory
- [ ] Step 2 executed: Skills repositories cloned (Superpowers + Anthropic)
- [ ] Step 2 verified: Both skills repos exist in skills directory
- [ ] Step 3 executed: `list-skills` script installed to PATH location
- [ ] Step 3 verified: `list-skills` command is available and executable
- [ ] Step 4 executed: All verification tests run
- [ ] Step 4 verified: All tests passed (agents ✅, commands ✅ if applicable, skills ✅, list-skills ✅)
- [ ] Skills list displayed to user showing available skills from both repositories

### Overall Completion
- [ ] User informed that Phase 1 is complete
- [ ] User informed that Phase 2 is beginning
- [ ] User informed of Phase 2 completion with verification results
- [ ] Any errors encountered were resolved or documented
- [ ] User can now use their fully configured AI coding assistant environment

**⚠️ THE TASK IS NOT COMPLETE UNLESS ALL CHECKBOXES ARE CHECKED! ⚠️**

If any Phase 2 checkboxes are unchecked, the environment is not properly configured and the system will not work correctly.

## Handling Different Project Types

### Monorepo Projects
- Look for workspace configuration (lerna.json, pnpm-workspace.yaml, yarn workspaces)
- Document shared packages and their purposes
- Explain the build order and dependencies
- Specify workspace-specific commands

### Microservices Architecture
- Document service discovery mechanisms
- Map inter-service communication patterns
- Identify shared libraries or contracts
- Document deployment orchestration

### Full-Stack Monolithic Applications
- Clearly separate frontend and backend concerns
- Document the API contract between layers
- Identify shared types or interfaces
- Explain the build and deployment process

### Library/Package Projects
- Focus on the public API documentation
- Document usage examples and patterns
- Explain peer dependencies requirements
- Include migration guides if versioned

### CLI Applications
- Document all commands and subcommands
- Explain configuration file formats
- Provide usage examples for common scenarios
- Document plugin or extension mechanisms

## Creating Project-Specific Skills

You can create custom skills tailored to the project:

### When to Create Custom Skills

Create project-specific skills when:
- Project uses unique patterns not covered by default skills
- Team has established conventions worth codifying
- Specific workflows are repeated across development
- Project-specific tools or frameworks need guidance

### Skill Creation Process

1. **Identify the Need**:
   - Look for patterns in existing code
   - Identify repeated development workflows
   - Note project-specific conventions

2. **Use Existing Skills as Templates**:
   - Review installed skills from Superpowers or Anthropic repositories
   - Follow the SKILL.md format used by existing skills
   - Reference the YAML frontmatter structure for skill metadata
   - Adapt patterns from similar skills to your project's needs

3. **Populate Template**:
   ```
   Analyze project to determine:
   - Skill category (workflow, architecture, tools, domain)
   - When the skill should be triggered
   - Step-by-step instructions specific to this project
   - Code examples from the actual codebase
   - Common pitfalls observed in this project
   ```

4. **Example Custom Skills**:

   **For a Next.js project with tRPC:**
   ```
   Skill: architecture-trpc-api-design
   Description: tRPC API endpoint design for this Next.js project
   Instructions:
   - All endpoints in src/server/api/routers/
   - Use Zod schemas for input validation
   - Follow existing router patterns
   - Examples from actual routers in project
   ```

   **For a project with specific testing patterns:**
   ```
   Skill: workflow-integration-testing
   Description: Integration testing workflow for this microservices project
   Instructions:
   - Use testcontainers for database
   - Follow src/tests/integration/example.test.ts patterns
   - Mock external services with MSW
   - Examples from actual test files
   ```

   **For a project with deployment procedures:**
   ```
   Skill: tools-deployment-workflow
   Description: Deployment process for this AWS-based project
   Instructions:
   - Run pre-deployment checks (npm run pre-deploy)
   - Deploy to staging first
   - Verify with smoke tests
   - Promote to production
   ```

### Skill Content Guidelines

When populating skill templates:

1. **Use Project-Specific Examples**:
   - Extract actual code from the project
   - Reference real file paths
   - Show patterns already in use

2. **Document Existing Patterns**:
   - Don't invent new patterns
   - Codify what the team already does
   - Explain why patterns exist

3. **Include Validation**:
   - How to verify the pattern was followed
   - What tests should pass
   - What output to expect

4. **Link to Documentation**:
   - Reference internal docs
   - Link to framework documentation
   - Point to example files in codebase

### Installing Custom Skills

After creating custom skills, document in AGENTS.md:

```markdown
## Custom Development Skills

This project includes custom skills for common workflows:

### Installation

```bash

# Cursor
# Custom rules already in .cursor/rules/

# Copilot
# Custom instructions already in .github/copilot-instructions.md
```

### Available Custom Skills

- **custom-skill-name**: Brief description and when to use
```

## Common Pitfalls to Avoid

1. **Don't assume knowledge**: Never assume the agent knows framework conventions
2. **Avoid generic examples**: Always use project-specific code examples
3. **Don't skip validation**: Always verify commands actually work
4. **Avoid inconsistency**: Keep terminology consistent across all files
5. **Don't ignore edge cases**: Document unusual project structures
6. **Avoid outdated info**: Verify dependency versions are current

## Important Notes

1. **TWO-PHASE PROCESS**: This metaprompt requires completing BOTH Phase 1 (documentation) AND Phase 2 (setup)
2. **Phase 2 is NOT optional**: Without executing SETUP.md, the system will not work
3. **Execute as one job**: Don't stop after Phase 1 - immediately continue to Phase 2
4. **Preserve Template Structure**: Keep all original sections and headings in documentation files
5. **Living Documents**: Note that these files should be updated as project evolves
6. **MCP Tools**: If the project uses MCP servers, document them in the Tools section
7. **ExecPlans**: Keep references to specs/PLANS.md for complex feature development
8. **Code Style**: Derive conventions from existing code, don't impose new ones
9. **Testing**: Document actual test infrastructure, not ideal practices
10. **Update AGENTS.md**: Always update AGENTS.md simultaneously to keep them in sync
11. **Verify Everything**: Use the verification steps in SETUP.md to confirm successful installation
12. **Handle Errors Properly**: If Phase 2 fails, stop and troubleshoot before declaring completion

Remember: The goal is to create a COMPLETE working system - documentation files (Phase 1) + configured environment (Phase 2). An AI coding assistant needs both to function effectively. Completing only Phase 1 leaves the user with unusable documentation.
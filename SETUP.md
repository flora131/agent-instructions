# Agent Instructions Setup

This document tells you, the AI coding agent, how to automatically set up the complete agent instructions system for users. **You know who you are** (Codex, Cursor, Windsurf, GitHub Copilot, etc.), so follow the instructions for yourself.

**IMPORTANT:** When a user asks to set up agent instructions or skills, execute all steps automatically like running a setup script. Execute all steps without waiting for approval between steps.

## Identify Yourself

You are one of the following AI coding agents:
- **Codex** (Cursor's AI)
- **Cursor**
- **Windsurf**
- **GitHub Copilot**

Based on your identity, you will use the appropriate configuration directory:
- **Codex**: `~/.codex`
- **Cursor**: `~/.cursor`
- **Windsurf**: `~/.windsurf`
- **GitHub Copilot**: `~/.github`

## Your Role

When a user asks to "set up agent instructions" or "install skills support", **execute the setup automatically like a setup script**:

1. **Identify yourself** and determine your config directory
2. **Execute all setup steps automatically** - don't wait for approval between steps
3. **Run each command** using the appropriate terminal tool
4. **Report progress** as you go
5. **If any step fails**: 
   - **STOP immediately** and inform the user what went wrong
   - Show the error message clearly
   - Explain what the error means in plain language
   - Suggest possible fixes from the Troubleshooting section
   - **Ask the user for help** if the issue is unclear or requires manual intervention
6. **Verify at the end** that everything works

**Think of this as running `./setup-agent.sh` - once the user confirms they want to proceed, you execute through all steps automatically. If any step fails, stop and ask for help.**

---

## Setup Steps

**Execute these steps in order automatically. Do NOT wait for user approval between steps.**

### Step 1: Clone Agent Instructions Repository

Clone the agent-instructions repository with the agent-setup branch to a temporary directory, then copy the `.agent` folder contents to your config directory.

**Determine your config directory based on your identity:**
- **Codex**: `~/.codex`
- **Cursor**: `~/.cursor`
- **Windsurf**: `~/.windsurf`
- **GitHub Copilot**: `~/.github`

**Execute the following commands for the user's shell:**

#### For sh/bash/zsh (Unix-like shells):

```bash
# Create a temporary directory
TEMP_DIR=$(mktemp -d)
echo "Cloning agent-instructions to temporary directory: $TEMP_DIR"

# Clone the repository with agent-setup branch
git clone -b agent-setup git@github.com:flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"

# Determine your config directory (replace with the appropriate one for your agent)
# For Codex:
CONFIG_DIR="$HOME/.codex"
# For Cursor:
# CONFIG_DIR="$HOME/.cursor"
# For Windsurf:
# CONFIG_DIR="$HOME/.windsurf"
# For GitHub Copilot:
# CONFIG_DIR="$HOME/.github"

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Backup existing agents folder if it exists
if [ -d "$CONFIG_DIR/agents" ]; then
  BACKUP_DIR="$CONFIG_DIR/agents.backup.$(date +%Y%m%d_%H%M%S)"
  echo "⚠️  Existing agents folder found. Creating backup at $BACKUP_DIR"
  cp -r "$CONFIG_DIR/agents" "$BACKUP_DIR"
fi

# Copy the agents folder from .agent to the config directory
# Use rsync if available for smart merging, otherwise use cp with no-clobber
if command -v rsync &> /dev/null; then
  echo "Using rsync to merge agents folder (won't overwrite existing files)..."
  rsync -a --ignore-existing "$TEMP_DIR/agent-instructions/.agent/agents/" "$CONFIG_DIR/agents/"
else
  echo "Copying agents folder (existing files will be preserved)..."
  cp -rn "$TEMP_DIR/agent-instructions/.agent/agents" "$CONFIG_DIR/" 2>/dev/null || {
    # If cp -n fails or isn't supported, use a more careful approach
    mkdir -p "$CONFIG_DIR/agents"
    find "$TEMP_DIR/agent-instructions/.agent/agents" -type f | while read file; do
      rel_path="${file#$TEMP_DIR/agent-instructions/.agent/agents/}"
      dest="$CONFIG_DIR/agents/$rel_path"
      if [ ! -f "$dest" ]; then
        mkdir -p "$(dirname "$dest")"
        cp "$file" "$dest"
      fi
    done
  }
fi

# Clean up temporary directory
rm -rf "$TEMP_DIR"

echo "✅ Successfully copied agents to $CONFIG_DIR"
echo "ℹ️  Note: Existing files were preserved. Backups created with timestamp if folders existed."
```

#### For fish shell:

```fish
# Create a temporary directory
set TEMP_DIR (mktemp -d)
echo "Cloning agent-instructions to temporary directory: $TEMP_DIR"

# Clone the repository with agent-setup branch
git clone -b agent-setup git@github.com:flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"

# Determine your config directory (replace with the appropriate one for your agent)
# For Codex:
set CONFIG_DIR "$HOME/.codex"
# For Cursor:
# set CONFIG_DIR "$HOME/.cursor"
# For Windsurf:
# set CONFIG_DIR "$HOME/.windsurf"
# For GitHub Copilot:
# set CONFIG_DIR "$HOME/.github"

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Backup existing agents folder if it exists
if test -d "$CONFIG_DIR/agents"
  set BACKUP_DIR "$CONFIG_DIR/agents.backup."(date +%Y%m%d_%H%M%S)
  echo "⚠️  Existing agents folder found. Creating backup at $BACKUP_DIR"
  cp -r "$CONFIG_DIR/agents" "$BACKUP_DIR"
end

# Copy the agents folder from .agent to the config directory
# Use rsync if available for smart merging
if command -v rsync &> /dev/null
  echo "Using rsync to merge agents folder (won't overwrite existing files)..."
  rsync -a --ignore-existing "$TEMP_DIR/agent-instructions/.agent/agents/" "$CONFIG_DIR/agents/"
else
  echo "Copying agents folder (existing files will be preserved)..."
  mkdir -p "$CONFIG_DIR/agents"
  for file in (find "$TEMP_DIR/agent-instructions/.agent/agents" -type f)
    set rel_path (string replace "$TEMP_DIR/agent-instructions/.agent/agents/" "" "$file")
    set dest "$CONFIG_DIR/agents/$rel_path"
    if not test -f "$dest"
      mkdir -p (dirname "$dest")
      cp "$file" "$dest"
    end
  end
end

# Clean up temporary directory
rm -rf "$TEMP_DIR"

echo "✅ Successfully copied agents to $CONFIG_DIR"
echo "ℹ️  Note: Existing files were preserved. Backups created with timestamp if folders existed."
```

#### For PowerShell (Windows):

```powershell
# Create a temporary directory
$TEMP_DIR = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
Write-Host "Cloning agent-instructions to temporary directory: $TEMP_DIR"

# Clone the repository with agent-setup branch
git clone -b agent-setup git@github.com:flora131/agent-instructions.git "$TEMP_DIR\agent-instructions"

# Determine your config directory (replace with the appropriate one for your agent)
# For Codex:
$CONFIG_DIR = "$env:USERPROFILE\.codex"
# For Cursor:
# $CONFIG_DIR = "$env:USERPROFILE\.cursor"
# For Windsurf:
# $CONFIG_DIR = "$env:USERPROFILE\.windsurf"
# For GitHub Copilot:
# $CONFIG_DIR = "$env:USERPROFILE\.github"

# Create config directory if it doesn't exist
New-Item -ItemType Directory -Force -Path $CONFIG_DIR | Out-Null

# Backup existing agents folder if it exists
if (Test-Path "$CONFIG_DIR\agents") {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $BACKUP_DIR = "$CONFIG_DIR\agents.backup.$timestamp"
    Write-Host "⚠️  Existing agents folder found. Creating backup at $BACKUP_DIR"
    Copy-Item -Recurse "$CONFIG_DIR\agents" "$BACKUP_DIR"
}

# Copy the agents folder from .agent to the config directory (preserve existing files)
Write-Host "Copying agents folder (existing files will be preserved)..."
if (-not (Test-Path "$CONFIG_DIR\agents")) {
    New-Item -ItemType Directory -Force -Path "$CONFIG_DIR\agents" | Out-Null
}

Get-ChildItem -Recurse -File "$TEMP_DIR\agent-instructions\.agent\agents" | ForEach-Object {
    $relativePath = $_.FullName.Substring("$TEMP_DIR\agent-instructions\.agent\agents".Length + 1)
    $destination = Join-Path "$CONFIG_DIR\agents" $relativePath
    
    if (-not (Test-Path $destination)) {
        $destDir = Split-Path -Parent $destination
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        }
        Copy-Item $_.FullName $destination
    }
}

# Clean up temporary directory
Remove-Item -Recurse -Force $TEMP_DIR

Write-Host "✅ Successfully copied agents to $CONFIG_DIR"
Write-Host "ℹ️  Note: Existing files were preserved. Backups created with timestamp if folders existed."
```

**IMPORTANT:** You should automatically use the correct `CONFIG_DIR` for your agent identity. Don't ask the user - you know who you are.

**Expected Result:**
After this step, your config directory should contain:
- `~/.codex/agents/` (or `~/.cursor/agents/`, `~/.windsurf/agents/`, `~/.github/agents/`, etc.)

**If this step fails:**
- Check if the error is related to Git authentication (SSH keys)
- Verify the agent-setup branch exists
- Show the full error message to the user
- Ask the user if they need to set up Git SSH keys or if they prefer using HTTPS instead

### Step 2: Clone Skills Repositories

Create a skills directory and clone both the Superpowers and Anthropic Skills repositories as subdirectories.

**Execute the following commands for the user's shell:**

#### For sh/bash/zsh:

```bash
# Use the same CONFIG_DIR determined in Step 1
# For Codex:
CONFIG_DIR="$HOME/.codex"
# For Cursor:
# CONFIG_DIR="$HOME/.cursor"
# For Windsurf:
# CONFIG_DIR="$HOME/.windsurf"
# For GitHub Copilot:
# CONFIG_DIR="$HOME/.github"

# Create skills directory
mkdir -p "$CONFIG_DIR/skills"

# Clone both repositories
git clone https://github.com/obra/superpowers.git "$CONFIG_DIR/skills/superpowers"
git clone https://github.com/anthropics/skills.git "$CONFIG_DIR/skills/anthropic-skills"

echo "✅ Successfully cloned skills repositories to $CONFIG_DIR/skills"
```

#### For fish shell:

```fish
# Use the same CONFIG_DIR determined in Step 1
# For Codex:
set CONFIG_DIR "$HOME/.codex"
# For Cursor:
# set CONFIG_DIR "$HOME/.cursor"
# For Windsurf:
# set CONFIG_DIR "$HOME/.windsurf"
# For GitHub Copilot:
# set CONFIG_DIR "$HOME/.github"

# Create skills directory
mkdir -p "$CONFIG_DIR/skills"

# Clone both repositories
git clone https://github.com/obra/superpowers.git "$CONFIG_DIR/skills/superpowers"
git clone https://github.com/anthropics/skills.git "$CONFIG_DIR/skills/anthropic-skills"

echo "✅ Successfully cloned skills repositories to $CONFIG_DIR/skills"
```

#### For PowerShell:

```powershell
# Use the same CONFIG_DIR determined in Step 1
# For Codex:
$CONFIG_DIR = "$env:USERPROFILE\.codex"
# For Cursor:
# $CONFIG_DIR = "$env:USERPROFILE\.cursor"
# For Windsurf:
# $CONFIG_DIR = "$env:USERPROFILE\.windsurf"
# For GitHub Copilot:
# $CONFIG_DIR = "$env:USERPROFILE\.github"

# Create skills directory
New-Item -ItemType Directory -Force -Path "$CONFIG_DIR\skills" | Out-Null

# Clone superpowers repository if it doesn't exist
if (Test-Path "$CONFIG_DIR\skills\superpowers") {
    Write-Host "ℹ️  Superpowers repository already exists at $CONFIG_DIR\skills\superpowers"
    Write-Host "   To update, run: cd $CONFIG_DIR\skills\superpowers; git pull"
} else {
    Write-Host "Cloning superpowers repository..."
    git clone https://github.com/obra/superpowers.git "$CONFIG_DIR\skills\superpowers"
}

# Clone anthropic-skills repository if it doesn't exist
if (Test-Path "$CONFIG_DIR\skills\anthropic-skills") {
    Write-Host "ℹ️  Anthropic skills repository already exists at $CONFIG_DIR\skills\anthropic-skills"
    Write-Host "   To update, run: cd $CONFIG_DIR\skills\anthropic-skills; git pull"
} else {
    Write-Host "Cloning anthropic-skills repository..."
    git clone https://github.com/anthropics/skills.git "$CONFIG_DIR\skills\anthropic-skills"
}

Write-Host "✅ Skills repositories ready at $CONFIG_DIR\skills"
```

**Note:** The script checks if directories already exist and skips cloning if they do. Users can manually update existing repositories using `git pull`. The `list-skills` script recursively searches for `SKILL.md` files in the skills directory, so both repositories will be automatically discovered.

**If this step fails:**
```

**Note:** The script checks if directories already exist and skips cloning if they do. Users can manually update existing repositories using `git pull`. The `list-skills` script recursively searches for `SKILL.md` files in the skills directory, so both repositories will be automatically discovered.

**If this step fails:**
- Show the full error message to the user
- Check if it's a network connectivity issue
- Verify Git is installed by running `git --version`
- Ask the user if they're behind a proxy or firewall that might block GitHub access

### Step 3: Install list-skills Script

Install the list-skills script to a location in the user's PATH.

**Prerequisites:** 
- **Unix/Mac/Linux:** The script is a bash shell script (`list-skills.sh`) - no additional dependencies required
- **Windows:** The script is a PowerShell script (`list-skills.ps1`) - PowerShell is pre-installed on Windows

**The scripts are located in the agent-instructions repository:**
- Unix/Mac/Linux: `scripts/list-skills.sh`
- Windows: `scripts/list-skills.ps1`

**Choose installation location:**

First, check if ~/bin is in PATH:

#### For sh/bash/zsh:

```bash
echo $PATH | grep -q "$HOME/bin" && echo "~/bin is in PATH" || echo "~/bin not in PATH"
```

#### For fish shell:

```fish
if string match -q "*$HOME/bin*" $PATH
    echo "~/bin is in PATH"
else
    echo "~/bin not in PATH"
end
```

#### For PowerShell:

```powershell
if ($env:PATH -like "*$env:USERPROFILE\bin*") {
    Write-Host "~/bin is in PATH"
} else {
    Write-Host "~/bin not in PATH"
}
```

**Option A: Install to ~/bin (recommended for single user)**

If ~/bin is already in PATH:

##### For sh/bash/zsh:

```bash
# Clone the repo temporarily to get the script
TEMP_DIR=$(mktemp -d)
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"

# Install script
mkdir -p ~/bin
cp "$TEMP_DIR/agent-instructions/scripts/list-skills.sh" ~/bin/list-skills
chmod +x ~/bin/list-skills

# Clean up
rm -rf "$TEMP_DIR"

echo "✅ list-skills script installed to ~/bin/list-skills"
```

##### For fish shell:

```fish
# Clone the repo temporarily to get the script
set TEMP_DIR (mktemp -d)
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"

# Install script
mkdir -p ~/bin
cp "$TEMP_DIR/agent-instructions/scripts/list-skills.sh" ~/bin/list-skills
chmod +x ~/bin/list-skills

# Clean up
rm -rf "$TEMP_DIR"

echo "✅ list-skills script installed to ~/bin/list-skills"
```

##### For PowerShell:

```powershell
# Clone the repo temporarily to get the script
$TEMP_DIR = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR\agent-instructions"

# Install script
$BIN_DIR = "$env:USERPROFILE\bin"
New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null
Copy-Item "$TEMP_DIR\agent-instructions\scripts\list-skills.ps1" "$BIN_DIR\list-skills.ps1"

# Clean up
Remove-Item -Recurse -Force $TEMP_DIR

Write-Host "✅ list-skills script installed to $BIN_DIR\list-skills.ps1"
```

**If ~/bin is NOT in PATH, add it first, then install:**

Detect the user's shell and add ~/bin to PATH:

##### For zsh (default on modern Macs):

```zsh
# Add to PATH
mkdir -p ~/bin
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Clone and install script
TEMP_DIR=$(mktemp -d)
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"
cp "$TEMP_DIR/agent-instructions/scripts/list-skills.sh" ~/bin/list-skills
chmod +x ~/bin/list-skills
rm -rf "$TEMP_DIR"

echo "✅ Added ~/bin to PATH and installed list-skills script"
```

##### For bash:

```bash
# Add to PATH
mkdir -p ~/bin
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Clone and install script
TEMP_DIR=$(mktemp -d)
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"
cp "$TEMP_DIR/agent-instructions/scripts/list-skills.sh" ~/bin/list-skills
chmod +x ~/bin/list-skills
rm -rf "$TEMP_DIR"

echo "✅ Added ~/bin to PATH and installed list-skills script"
```

##### For bash on macOS (login shell):

```bash
# Add to PATH
mkdir -p ~/bin
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bash_profile
source ~/.bash_profile

# Clone and install script
TEMP_DIR=$(mktemp -d)
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"
cp "$TEMP_DIR/agent-instructions/scripts/list-skills.sh" ~/bin/list-skills
chmod +x ~/bin/list-skills
rm -rf "$TEMP_DIR"

echo "✅ Added ~/bin to PATH and installed list-skills script"
```

##### For fish shell:

```fish
# Add to PATH
mkdir -p ~/bin
fish_add_path ~/bin

# Clone and install script
set TEMP_DIR (mktemp -d)
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"
cp "$TEMP_DIR/agent-instructions/scripts/list-skills.sh" ~/bin/list-skills
chmod +x ~/bin/list-skills
rm -rf "$TEMP_DIR"

echo "✅ Added ~/bin to PATH and installed list-skills script"
```

##### For PowerShell:

```powershell
# Add to PATH permanently (User PATH variable)
$BIN_DIR = "$env:USERPROFILE\bin"
New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null

# Get current user PATH
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$BIN_DIR*") {
    [Environment]::SetEnvironmentVariable("PATH", "$BIN_DIR;$currentPath", "User")
    $env:PATH = "$BIN_DIR;$env:PATH"  # Update current session
    Write-Host "Added $BIN_DIR to PATH"
}

# Clone and install script
$TEMP_DIR = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR\agent-instructions"
Copy-Item "$TEMP_DIR\agent-instructions\scripts\list-skills.ps1" "$BIN_DIR\list-skills.ps1"
Remove-Item -Recurse -Force $TEMP_DIR

Write-Host "✅ Added ~/bin to PATH and installed list-skills script"
```

**Option B: Install to /usr/local/bin (Unix/Mac system-wide, requires sudo)**

##### For sh/bash/zsh/fish:

```bash
# Clone the repo temporarily to get the script
TEMP_DIR=$(mktemp -d)
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"

# Install script (requires sudo)
sudo cp "$TEMP_DIR/agent-instructions/scripts/list-skills.sh" /usr/local/bin/list-skills
sudo chmod +x /usr/local/bin/list-skills

# Clean up
rm -rf "$TEMP_DIR"

echo "✅ list-skills script installed to /usr/local/bin/list-skills"
```

**Note:** /usr/local/bin is already in PATH on most Unix/Mac systems and doesn't require shell config changes. This is simpler but requires admin privileges.

**If this step fails:**
- Show the full error message to the user
- Check if Node.js is installed: `node --version`
- If PATH modifications fail, inform the user they may need to restart their terminal
- Ask the user if they prefer Option A (~/bin) or Option B (/usr/local/bin) if one fails

### Step 4: Verify Setup

After completing all setup steps, automatically verify everything is working.

**Determine your config directory based on your identity:**
- **Codex**: `~/.codex`
- **Cursor**: `~/.cursor`
- **Windsurf**: `~/.windsurf`
- **GitHub Copilot**: `~/.github`

**Run verification tests:**

#### For sh/bash/zsh/fish:

```bash
# Replace with your actual config directory
# For Codex:
CONFIG_DIR="$HOME/.codex"
# For Cursor:
# CONFIG_DIR="$HOME/.cursor"
# For Windsurf:
# CONFIG_DIR="$HOME/.windsurf"
# For GitHub Copilot:
# CONFIG_DIR="$HOME/.github"

echo "Verifying setup for $CONFIG_DIR..."

# Test 1: Check agents folder exists
if [ -d "$CONFIG_DIR/agents" ]; then
    echo "✅ Agents folder found"
else
    echo "❌ Agents folder missing"
fi

# Test 2: Check skills directory exists
if [ -d "$CONFIG_DIR/skills" ]; then
    echo "✅ Skills directory found"
else
    echo "❌ Skills directory missing"
fi

# Test 3: Test list-skills script
if command -v list-skills &> /dev/null; then
    echo "✅ list-skills command available"
    echo "Testing list-skills script with your skills directory..."
    list-skills "$CONFIG_DIR/skills"
else
    echo "❌ list-skills command not found in PATH"
fi
```

#### For PowerShell:

```powershell
# Replace with your actual config directory
# For Codex:
$CONFIG_DIR = "$env:USERPROFILE\.codex"
# For Cursor:
# $CONFIG_DIR = "$env:USERPROFILE\.cursor"
# For Windsurf:
# $CONFIG_DIR = "$env:USERPROFILE\.windsurf"
# For GitHub Copilot:
# $CONFIG_DIR = "$env:USERPROFILE\.github"

Write-Host "Verifying setup for $CONFIG_DIR..."

# Test 1: Check agents folder exists
if (Test-Path "$CONFIG_DIR\agents") {
    Write-Host "✅ Agents folder found"
} else {
    Write-Host "❌ Agents folder missing"
}

# Test 2: Check skills directory exists
if (Test-Path "$CONFIG_DIR\skills") {
    Write-Host "✅ Skills directory found"
} else {
    Write-Host "❌ Skills directory missing"
}

# Test 3: Test list-skills script
if (Get-Command list-skills -ErrorAction SilentlyContinue) {
    Write-Host "✅ list-skills command available"
    Write-Host "Testing list-skills with your skills directory..."
    list-skills "$CONFIG_DIR\skills"
} else {
    Write-Host "❌ list-skills command not found in PATH"
}
```

**Expected output:**
- ✅ Agents folder found
- ✅ Skills directory found
- ✅ list-skills command available
- JSON array of available skills (showing skills from both superpowers and anthropic-skills repositories)

**Example JSON output from list-skills:**
```json
[
  {
    "name": "brainstorming",
    "description": "Transform rough ideas into fully-formed designs...",
    "path": "/Users/username/.codex/skills/superpowers/brainstorming/SKILL.md"
  },
  {
    "name": "debugging",
    "description": "Systematic approach to finding and fixing bugs...",
    "path": "/Users/username/.codex/skills/anthropic-skills/debugging/SKILL.md"
  }
]
```

**Report results:**
- If all tests pass: "✅ Agent instructions setup complete! You have X skills available and your config is located at [CONFIG_DIR]"
- If any test fails: 
  - **Stop and clearly explain which test failed**
  - Show the specific error or missing component
  - Provide relevant troubleshooting steps from the Troubleshooting section
  - **Ask the user**: "I encountered an issue during setup verification. Would you like me to:
    1. Try to fix this automatically using the troubleshooting steps?
    2. Show you the commands to run manually?
    3. Help you investigate the issue further?"

---

## Troubleshooting Common Issues

**IMPORTANT:** When helping the user troubleshoot:
1. **Always show the actual error message** you encountered
2. **Explain in plain language** what the error means
3. **Ask clarifying questions** if you need more information
4. **Offer multiple solutions** when applicable
5. **Let the user choose** which fix to try first
6. **If a fix doesn't work**, try the next option and keep the user informed

If setup verification fails, help the user debug:

### Error: "Agents folder missing"

**Diagnosis:**

Check if the folders were copied correctly:

#### For sh/bash/zsh/fish:

```bash
# Replace with your config directory
CONFIG_DIR="$HOME/.codex"  # or ~/.cursor, ~/.windsurf, ~/.github

ls -la "$CONFIG_DIR"
ls -la "$CONFIG_DIR/agents"
```

#### For PowerShell:

```powershell
# Replace with your config directory
$CONFIG_DIR = "$env:USERPROFILE\.codex"  # or .cursor, .windsurf, .github

Get-ChildItem $CONFIG_DIR
Get-ChildItem "$CONFIG_DIR\agents"
```

**Possible causes:**
- Git clone failed
- Copy commands didn't execute correctly
- Wrong source path used (should be `.agent/agents`, not `.agent` itself)

**Fix:**

**First, inform the user:**
"I found that the agents folder is missing. This usually means the Git clone or copy operation in Step 1 didn't complete successfully. Let me show you what I found and what we can do to fix it."

Then offer to re-run Step 1, ensuring the copy commands target the correct source directory:
- Source: `$TEMP_DIR/agent-instructions/.agent/agents` → Destination: `$CONFIG_DIR/agents`

**Ask the user:** "Would you like me to try running Step 1 again, or would you prefer to investigate the original error first?"

### Error: "missing skills dir"

**Diagnosis:**

Check if the skills directory exists:

#### For sh/bash/zsh/fish:

```bash
# Replace with your config directory
CONFIG_DIR="$HOME/.codex"  # or ~/.cursor, ~/.windsurf, ~/.github

ls "$CONFIG_DIR/skills"
ls "$CONFIG_DIR/skills/superpowers"
ls "$CONFIG_DIR/skills/anthropic-skills"
```

#### For PowerShell:

```powershell
# Replace with your config directory
$CONFIG_DIR = "$env:USERPROFILE\.codex"  # or .cursor, .windsurf, .github

Get-ChildItem "$CONFIG_DIR\skills"
Get-ChildItem "$CONFIG_DIR\skills\superpowers"
Get-ChildItem "$CONFIG_DIR\skills\anthropic-skills"
```

**Possible causes:**
- Skills directory doesn't exist
- Git clone failed

**Fix:**

**First, inform the user:**
"The skills directory is missing or incomplete. This means the Git clone operations in Step 2 didn't succeed. Here's what I found: [show which directories are missing]."

**Common causes:**
- Network connectivity issues
- GitHub rate limiting
- Insufficient disk space

**Ask the user:** "Would you like me to:
1. Try cloning the skills repositories again?
2. Check your internet connection and GitHub access first?
3. Try cloning just one repository at a time to isolate the issue?"

### Error: "command not found: list-skills"

**Diagnosis:**

#### For sh/bash/zsh/fish:

```bash
which list-skills
echo $PATH | grep bin
```

#### For PowerShell:

```powershell
Get-Command list-skills -ErrorAction SilentlyContinue
$env:PATH -split ";" | Where-Object { $_ -like "*bin*" }
```

**Possible causes:**
- Script not copied to PATH location
- ~/bin not in PATH
- Permissions issue (Unix/Mac only)

**Fix:**

1. Verify the script exists:

#### For sh/bash/zsh/fish:

```bash
ls -l ~/bin/list-skills
# or
ls -l /usr/local/bin/list-skills
```

#### For PowerShell:

```powershell
Get-Item "$env:USERPROFILE\bin\list-skills.ps1"
```

2. Check permissions (Unix/Mac):

```bash
chmod +x ~/bin/list-skills
```

3. If ~/bin not in PATH, you have two options:

**Option A: Add ~/bin to PATH permanently**

First, detect which shell the user is using:

#### For sh/bash/zsh:

```bash
echo $SHELL
```

Then add ~/bin to PATH in the appropriate config file:

##### For zsh (default on modern Macs):

```zsh
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

##### For bash:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

##### For bash on macOS (login shell):

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bash_profile
source ~/.bash_profile
```

##### For fish:

```fish
fish_add_path ~/bin
```

##### For PowerShell:

```powershell
$BIN_DIR = "$env:USERPROFILE\bin"
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$BIN_DIR*") {
    [Environment]::SetEnvironmentVariable("PATH", "$BIN_DIR;$currentPath", "User")
    $env:PATH = "$BIN_DIR;$env:PATH"
}
```

**Option B: Use /usr/local/bin instead (Unix/Mac)**

```bash
# Clone and install to /usr/local/bin
TEMP_DIR=$(mktemp -d)
git clone https://github.com/flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"
sudo cp "$TEMP_DIR/agent-instructions/scripts/list-skills.sh" /usr/local/bin/list-skills
sudo chmod +x /usr/local/bin/list-skills
rm -rf "$TEMP_DIR"
```

This location is already in PATH on most systems and doesn't require shell config changes.

**If PATH fixes don't work:**

**Inform the user:**
"I've tried adding ~/bin to your PATH, but the list-skills command still isn't being found. This might require:
1. Restarting your terminal or shell session
2. Checking for shell configuration conflicts
3. Using the /usr/local/bin installation method instead

The error I'm seeing is: [show actual error]"

**Ask the user:** "Would you like me to:
1. Try installing to /usr/local/bin instead (requires sudo)?
2. Show you the commands to manually verify your PATH configuration?
3. Wait while you restart your terminal and try again?"

### Error: "list-skills: command not found" or script execution issues

**Fix:**

The list-skills scripts are native shell scripts and don't require Node.js:
- **Unix/Mac/Linux**: Uses `list-skills.sh` (bash script)
- **Windows**: Uses `list-skills.ps1` (PowerShell script)

If you see execution errors:

#### For Unix/Mac/Linux:

1. Verify the script is executable:
```bash
chmod +x ~/bin/list-skills
# or
sudo chmod +x /usr/local/bin/list-skills
```

2. Ensure it's a shell script (not a Node.js file):
```bash
head -1 ~/bin/list-skills
# Should show: #!/usr/bin/env bash
```

#### For Windows:

1. Ensure PowerShell execution policy allows scripts:
```powershell
Get-ExecutionPolicy
# If it shows "Restricted", update it:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

2. Run the script with PowerShell explicitly if needed:
```powershell
pwsh "$env:USERPROFILE\bin\list-skills.ps1" "$env:USERPROFILE\.github\skills"
```

### Agent Can't Access Configuration

**Possible causes:**
- Agent not reading configuration files correctly
- Incorrect directory structure
- `list-skills` command not working

**Diagnosis:**

Verify the directory structure:

#### For sh/bash/zsh/fish:

```bash
# Replace with your config directory
CONFIG_DIR="$HOME/.codex"  # or ~/.cursor, ~/.windsurf, ~/.github

echo "Directory structure:"
tree -L 2 "$CONFIG_DIR"
# or if tree is not available:
find "$CONFIG_DIR" -maxdepth 2 -type d
```

#### For PowerShell:

```powershell
# Replace with your config directory
$CONFIG_DIR = "$env:USERPROFILE\.codex"  # or .cursor, .windsurf, .github

Write-Host "Directory structure:"
Get-ChildItem -Recurse -Depth 2 $CONFIG_DIR | Where-Object { $_.PSIsContainer }
```

**Expected structure:**
```
~/.codex/                      (or ~/.cursor, ~/.windsurf, ~/.github)
├── agents/
│   └── [agent config files]
└── skills/
    ├── superpowers/
    │   └── [skill folders with SKILL.md files]
    └── anthropic-skills/
        └── [skill folders with SKILL.md files]
```

**Fix:**

**First, inform the user:**
"I've checked your configuration directory structure and found it doesn't match the expected layout. Here's what I found:

[Show actual directory structure]

Expected structure:
[Show expected structure]

The mismatch suggests: [explain what might have gone wrong based on the actual structure]"

**Ask the user:** "This usually means one or more setup steps didn't complete correctly. Would you like me to:
1. Run the full setup again from the beginning?
2. Try to fix just the missing or incorrect parts?
3. Back up your current config and start fresh?
4. Investigate further to understand what went wrong?"

If the user agrees to re-run, ensure:
1. Step 1 copies the `agents` folder to the root of your config directory
2. Step 2 creates the `skills` directory and clones both skill repositories as subdirectories

---

## Additional Information

Share these tips with users as needed:

### Directory Structure

After successful setup, your agent's config directory should contain:

```
~/.codex/                      (or ~/.cursor, ~/.windsurf, ~/.github)
├── agents/                     # Agent configuration files
│   └── [config files]
└── skills/                     # Skills repositories
    ├── superpowers/           # Obra's Superpowers skills
    │   ├── brainstorming/
    │   │   └── SKILL.md
    │   ├── debugging/
    │   │   └── SKILL.md
    │   └── [other skills]/
    └── anthropic-skills/      # Anthropic's official skills
        ├── [skill folders]/
        └── SKILL.md files
```

### Multiple Agents on Same Machine

You can set up multiple agents on the same machine. Each agent gets its own config directory:
- Codex: `~/.codex`
- Cursor: `~/.cursor`
- Windsurf: `~/.windsurf`
- GitHub Copilot: `~/.github`

All agents can coexist and share the same `list-skills` script installation.

### Custom Skills

Users can create their own skills in their agent's skills directory.

#### For sh/bash/zsh/fish:

```bash
# For Codex (or replace with your agent's directory):
mkdir -p ~/.codex/skills/my-custom-skill
```

#### For PowerShell:

```powershell
# For Codex (or replace with your agent's directory):
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.codex\skills\my-custom-skill"
```

Then create `SKILL.md` with YAML front-matter:
```markdown
---
name: my-custom-skill
description: What this skill does
---

# Skill Instructions
[Content here]
```

The skill will automatically appear in `list-skills` output.

### Updating Skills Repositories

To update the skills repositories, navigate to your agent's skills directory and pull the latest changes.

#### For sh/bash/zsh/fish:

```bash
# For Codex (replace with your agent's directory):
CONFIG_DIR="$HOME/.codex"

cd "$CONFIG_DIR/skills/superpowers" && git pull origin main
cd "$CONFIG_DIR/skills/anthropic-skills" && git pull origin main
```

#### For PowerShell:

```powershell
# For Codex (replace with your agent's directory):
$CONFIG_DIR = "$env:USERPROFILE\.codex"

Set-Location "$CONFIG_DIR\skills\superpowers"
git pull origin main

Set-Location "$CONFIG_DIR\skills\anthropic-skills"
git pull origin main
```

Skills update immediately - no agent restart needed.

### Updating Agent Configuration

To update the agents folder with the latest changes from the agent-instructions repository:

#### For sh/bash/zsh/fish:

```bash
# For Codex (replace with your agent's directory):
CONFIG_DIR="$HOME/.codex"

# Clone to temporary directory
TEMP_DIR=$(mktemp -d)
git clone -b agent-setup git@github.com:flora131/agent-instructions.git "$TEMP_DIR/agent-instructions"

# Backup existing config with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
if [ -d "$CONFIG_DIR/agents" ]; then
  cp -r "$CONFIG_DIR/agents" "$CONFIG_DIR/agents.backup.$TIMESTAMP"
  echo "Backed up agents to agents.backup.$TIMESTAMP"
fi

# Copy updated config (preserve existing files)
if command -v rsync &> /dev/null; then
  echo "Using rsync to merge updated config (won't overwrite existing files)..."
  rsync -a --ignore-existing "$TEMP_DIR/agent-instructions/.agent/agents/" "$CONFIG_DIR/agents/"
else
  echo "Copying updated config (existing files will be preserved)..."
  find "$TEMP_DIR/agent-instructions/.agent/agents" -type f | while read file; do
    rel_path="${file#$TEMP_DIR/agent-instructions/.agent/agents/}"
    dest="$CONFIG_DIR/agents/$rel_path"
    if [ ! -f "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp "$file" "$dest"
    fi
  done
fi

# Clean up
rm -rf "$TEMP_DIR"

echo "✅ Agent configuration updated"
echo "ℹ️  Note: Existing files were preserved. Backups created with timestamp."
```

#### For PowerShell:

```powershell
# For Codex (replace with your agent's directory):
$CONFIG_DIR = "$env:USERPROFILE\.codex"

# Clone to temporary directory
$TEMP_DIR = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
git clone -b agent-setup git@github.com:flora131/agent-instructions.git "$TEMP_DIR\agent-instructions"

# Backup existing config with timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
if (Test-Path "$CONFIG_DIR\agents") {
    Copy-Item -Recurse "$CONFIG_DIR\agents" "$CONFIG_DIR\agents.backup.$timestamp"
    Write-Host "Backed up agents to agents.backup.$timestamp"
}

# Copy updated config (preserve existing files)
Write-Host "Copying updated config (existing files will be preserved)..."
Get-ChildItem -Recurse -File "$TEMP_DIR\agent-instructions\.agent\agents" | ForEach-Object {
    $relativePath = $_.FullName.Substring("$TEMP_DIR\agent-instructions\.agent\agents".Length + 1)
    $destination = Join-Path "$CONFIG_DIR\agents" $relativePath
    
    if (-not (Test-Path $destination)) {
        $destDir = Split-Path -Parent $destination
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        }
        Copy-Item $_.FullName $destination
    }
}

# Clean up
Remove-Item -Recurse -Force $TEMP_DIR

Write-Host "✅ Agent configuration updated"
Write-Host "ℹ️  Note: Existing files were preserved. Backups created with timestamp."
        $destDir = Split-Path -Parent $destination
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        }
        Copy-Item $_.FullName $destination
    }
}

# Clean up
Remove-Item -Recurse -Force $TEMP_DIR

Write-Host "✅ Agent configuration updated"
Write-Host "ℹ️  Note: Existing files were preserved. Backups created with timestamp."
```

---

## Resources

- [Superpowers Skills Repo](https://github.com/obra/superpowers/tree/main)
- [Anthropic Skills Repo](https://github.com/anthropics/skills)
- [Node.js Downloads](https://nodejs.org/)

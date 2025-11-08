#!/usr/bin/env pwsh

# Usage: list-skills.ps1 <skills-directory>

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$SkillsDirectory
)

# Expand ~ to home directory
$ROOT = $SkillsDirectory -replace '^~', $HOME

if (-not (Test-Path -Path $ROOT -PathType Container)) {
    Write-Error "missing skills dir: $ROOT"
    exit 1
}

# Find all SKILL.md files and parse their frontmatter
$skills = Get-ChildItem -Path $ROOT -Filter "SKILL.md" -Recurse -File | ForEach-Object {
    $file = $_.FullName
    $content = Get-Content -Path $file -Raw
    
    # Extract frontmatter (between --- markers)
    if ($content -match '(?s)^---\s*\n(.*?)\n---') {
        $frontmatter = $matches[1]
        
        $name = ""
        $description = ""
        $allowedTools = @()
        
        # Parse each line of frontmatter
        $frontmatter -split "`n" | ForEach-Object {
            $line = $_.Trim()
            
            # Skip comments and empty lines
            if ($line -match '^#' -or [string]::IsNullOrWhiteSpace($line)) {
                return
            }
            
            # Parse key: value pairs
            if ($line -match '^name:\s*(.+)$') {
                $name = $matches[1].Trim() -replace '^[''"]|[''"]$', ''
            }
            elseif ($line -match '^description:\s*(.+)$') {
                $description = $matches[1].Trim() -replace '^[''"]|[''"]$', ''
            }
            elseif ($line -match '^allowed-tools:\s*\[(.+)\]$') {
                $toolsString = $matches[1]
                $allowedTools = $toolsString -split ',' | ForEach-Object {
                    $_.Trim() -replace '^[''"]|[''"]$', ''
                } | Where-Object { $_ -ne '' }
            }
        }
        
        # Return valid skills
        if ($name -and $description) {
            [PSCustomObject]@{
                name = $name
                description = $description
                path = $file
                'allowed-tools' = $allowedTools
            }
        }
    }
} | Sort-Object -Property name

# Convert to JSON
if ($skills) {
    $skills | ConvertTo-Json -AsArray -Depth 3
} else {
    "[]"
}

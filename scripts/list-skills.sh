#!/usr/bin/env bash

# Usage: list-skills.sh <skills-directory>

if [ $# -lt 1 ]; then
  echo "Usage: list-skills <skills-directory>" >&2
  exit 1
fi

ROOT="${1/#\~/$HOME}"

if [ ! -d "$ROOT" ]; then
  echo "missing skills dir: $ROOT" >&2
  exit 1
fi

# Find all SKILL.md files and parse their frontmatter
find "$ROOT" -name "SKILL.md" -type f | while IFS= read -r file; do
  # Extract frontmatter (between --- markers)
  in_frontmatter=false
  name=""
  description=""
  allowed_tools=""
  
  while IFS= read -r line; do
    # Check for frontmatter start
    if [ "$line" = "---" ]; then
      if [ "$in_frontmatter" = false ]; then
        in_frontmatter=true
        continue
      else
        # End of frontmatter
        break
      fi
    fi
    
    if [ "$in_frontmatter" = true ]; then
      # Skip comments and empty lines
      if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "${line// }" ]]; then
        continue
      fi
      
      # Parse key: value pairs
      if [[ "$line" =~ ^name:[[:space:]]*(.*) ]]; then
        name="${BASH_REMATCH[1]}"
        # Remove quotes
        name="${name#[\"\']}"
        name="${name%[\"\']}"
      elif [[ "$line" =~ ^description:[[:space:]]*(.*) ]]; then
        description="${BASH_REMATCH[1]}"
        # Remove quotes
        description="${description#[\"\']}"
        description="${description%[\"\']}"
      elif [[ "$line" =~ ^allowed-tools:[[:space:]]*(.*) ]]; then
        allowed_tools="${BASH_REMATCH[1]}"
      fi
    fi
  done < "$file"
  
  # Output valid skills as JSON
  if [ -n "$name" ] && [ -n "$description" ]; then
    echo "$name|$description|$file|$allowed_tools"
  fi
done | sort -t'|' -k1,1 | {
  # Convert to JSON array
  echo "["
  first=true
  while IFS='|' read -r name description path allowed_tools; do
    if [ "$first" = true ]; then
      first=false
    else
      echo ","
    fi
    
    printf '  {\n    "name": "%s",\n    "description": "%s",\n    "path": "%s"' \
      "$(echo "$name" | sed 's/"/\\"/g')" \
      "$(echo "$description" | sed 's/"/\\"/g')" \
      "$(echo "$path" | sed 's/"/\\"/g')"
    
    if [ -n "$allowed_tools" ]; then
      # Parse array format [item1, item2]
      if [[ "$allowed_tools" =~ ^\[(.*)\]$ ]]; then
        tools="${BASH_REMATCH[1]}"
        printf ',\n    "allowed-tools": ['
        tool_first=true
        IFS=',' read -ra TOOLS <<< "$tools"
        for tool in "${TOOLS[@]}"; do
          # Trim whitespace and quotes
          tool=$(echo "$tool" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//')
          if [ "$tool_first" = true ]; then
            tool_first=false
          else
            printf ', '
          fi
          printf '"%s"' "$(echo "$tool" | sed 's/"/\\"/g')"
        done
        printf ']'
      fi
    fi
    
    printf '\n  }'
  done
  echo ""
  echo "]"
}

# kawa.mcp

Reference implementation of the Kawa Code MCP protocol.

## Overview

The Kawa Code MCP server provides the communication layer used by
Kawa Code to record and align development intent between
developers and AI systems.

It enables:

• Persistent AI reasoning context
• Intent tracking during development workflows
• Alignment between human and AI decisions over time

This repository contains the reference implementation of the
Kawa MCP server used by Kawa Code tools.

This MCP server enables AI coding assistants to understand what you're working on and maintain context across sessions. It connects to the Kawa Code desktop application to provide:

- **Intent tracking**: Create and manage development intents with decision history
- **Team collaboration**: See what teammates are working on, detect conflicts
- **Decision recording**: Track architectural decisions and trade-offs with constraint validation
- **Code block assignment**: Associate code changes with intents for better commit history

## Usage

The MCP server works together with Kawa Code, AI code generators such as Cursor, Claude Code,
and the Kawa Code extensions.

## Key Features

- **Context Persistence**: Never lose track of what you were working on across AI sessions
- **Smart Context Retrieval**: Relevance-based context loading - only fetch what's needed for the current task
- **Zero-Knowledge Encryption**: Code blocks encrypted client-side before cloud sync, API cannot decrypt
- **Team Conflict Detection**: Know when teammates are working on the same files/lines
- **Decision Tracking**: Record architectural decisions with constraint validation and conflict detection
- **Commit Integration**: Link all code changes to intent context for better git history
- **Cross-Platform**: Works with Claude Code and Cursor AI via MCP protocol

## Version Compatibility

Use the version of kawa.mcp that matches your Kawa Code version:

| Kawa Code version | kawa.mcp version | Install command       |
|-------------------|------------------|-----------------------|
| 4.0.2             | v4.0.2           | `git checkout v4.0.2` |
| 5.0.0+ (latest)   | v5.0.0           | `git checkout v5.0.0` |

After checking out the correct tag, run `npm install && npm run build` to rebuild.

## Prerequisites

### Required

- **Node.js >= 18.0.0** — runtime for the MCP server
- **[Kawa Code](https://codeawareness.com/product) desktop app running** — kawa.mcp is a thin MCP-to-IPC adapter; all git operations, storage, and API communication happen in Kawa Code
- **Active Kawa Code account** — for cloud sync and team features

### Optional (for `kawa-infer` history analysis)

- **Python 3** — runs the inference scripts (`scripts/infer_from_commits.py`, `scripts/evolve_stories.py`)
- **`anthropic` Python package** — `pip install anthropic` (or use `uv run` — scripts include [PEP 723](https://peps.python.org/pep-0723/) inline metadata)
- **`ANTHROPIC_API_KEY` environment variable** — Claude API key for LLM-powered commit analysis
- **[GitHub CLI (`gh`)](https://cli.github.com/)** — enables richer data tiers (PR descriptions, review comments, issue discussions). Without `gh`, inference falls back to Tier 1 (commit messages only)

## Installation

```bash
# Clone the repository (if not already cloned)
cd /path/to/kawa.mcp

# Install dependencies
npm install

# Build the TypeScript source
npm run build
```

## Quick Start

1. **Start Kawa Code**: Launch the Kawa Code desktop app and log in
2. **Configure MCP**: Add kawa.mcp to your AI assistant's MCP configuration (see Configuration section)
3. **Restart AI**: Restart Claude Code or Cursor to load the MCP server
4. **Test connection**: The server will try to connect to Kawa Code on startup
5. **Start coding**: Use `check_active_intent` to begin tracking your work

## Setting Up CLAUDE.md

For Claude Code to use the MCP tools effectively, your project needs a `CLAUDE.md` file that tells Claude *when* to call the tools and provides your repository coordinates.

Copy the example template into your project root and fill in the placeholders:

```bash
cp /path/to/kawa.mcp/CLAUDE.md.example /path/to/your-project/CLAUDE.md
```

Or just merge the example with your own content.
See [`CLAUDE.md.example`](./CLAUDE.md.example) for the full template with optional sections for monorepos, code style, and architecture.

## Configuration

### Claude Code

Create a `.mcp.json` file in your project root (recommended for teams — commit it to git):

```json
{
  "mcpServers": {
    "kawa-intents": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/kawa.mcp/build/index.js"]
    }
  }
}
```

Or add it at user level (available across all your projects):

```bash
claude mcp add --transport stdio kawa-intents --scope user -- node /absolute/path/to/kawa.mcp/build/index.js
```

### Cursor AI

Add to your Cursor MCP configuration (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "kawa-intents": {
      "command": "node",
      "args": ["/absolute/path/to/kawa.mcp/build/index.js"]
    }
  }
}
```

**Important:** Use absolute paths, not relative paths or `~` shortcuts.

## Available Tools

### Context & Discovery

| Tool                   | Description                             |
|------------------------|-----------------------------------------|
| `get_relevant_context` | Get context relevant to a specific task |

### Intent Management

| Tool                         | Description                                                |
|------------------------------|------------------------------------------------------------|
| `check_active_intent`        | Check if there's an active intent before starting new work |
| `create_and_activate_intent` | Create and activate a new intent for a development task    |
| `get_intents_for_file`       | Get intents (team and self) affecting a specific file      |
| `get_intents_for_lines`      | Get intents affecting specific line ranges in a file       |
| `assign_blocks_to_intent`    | Assign modified line ranges to the active intent           |
| `get_intent_changes`         | Get uncommitted changes for the active intent              |
| `complete_intent`            | Complete an intent (committed/done/abandoned)              |
| `list_team_intents`          | List what teammates are currently working on               |

### Decision Recording

| Tool                      | Description                                                               |
|---------------------------|---------------------------------------------------------------------------|
| `record_decision`         | Record an architectural decision with rationale and constraint validation |
| `get_session_decisions`   | Get decisions recorded during the current session                         |
| `get_project_decisions`   | Get all decisions across all intents for the project                      |
| `edit_session_decision`   | Edit or delete a decision before intent completion                        |
| `detect_intent_conflicts` | Detect if current intent decisions conflict with team decisions           |

### Lightweight Logging

| Tool       | Description                                                                                    |
|------------|------------------------------------------------------------------------------------------------|
| `log_work` | Log completed work without the full intent lifecycle — use for quick fixes and trivial changes |

## MCP Capabilities

### Prompts

The server exposes prompts that can be loaded into your AI coding session:

- **`implementation_workflow`**: Standard workflow for implementing code changes with intent tracking. Provides step-by-step guidance on checking for active intents, creating new intents, checking for conflicts, and assigning blocks.

### Resources

The server exposes resources that can be monitored:

- **`kawa://intent/active`**: Real-time view of the currently active intent for the connected repository (JSON format)

## Intent Inference Tool

The `kawa-infer` tool analyzes commit history to automatically create intents, decisions, and lessons for past work — useful for bootstrapping a repository with historical context.

### Setup

```bash
# Install the Python dependency (one of):
pip install anthropic          # pip
uv pip install anthropic       # uv

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Optional: install gh CLI for richer data (PR comments, issues)
# https://cli.github.com/
```

### Usage

```bash
npx kawa-infer /path/to/your/repo --commits 200
```

**Options:**

| Flag               | Description                                                        |
|--------------------|--------------------------------------------------------------------|
| `--commits N`      | Number of recent commits to analyze (default: 50)                  |
| `--tier {1-5}`     | Data enrichment tier (default: 4, see below)                       |
| `--dry-run`        | Show what would be created without writing anything                |
| `--estimate-only`  | Show token/cost estimate and exit                                  |
| `--output FILE`    | Write results to JSON file                                         |
| `--max-stories N`  | Limit number of stories to generate                                |
| `--model MODEL`    | Claude model to use (default: haiku)                               |
| `--no-rate-limit`  | Disable rate limiting (for higher API tiers)                       |
| `--context-issues` | Include contextual issues from commit date range (requires tier 4) |
| `--resume FILE`    | Resume from a previous cache file                                  |

### Data Tiers

Each tier adds more context for better inference. Higher tiers require `gh` CLI authenticated.

| Tier | Data source                                        | Requires `gh` |
|------|----------------------------------------------------|---------------|
| 1    | Commit messages + numstat                          | No            |
| 2    | + PR descriptions and review comments              | Yes           |
| 3    | + Diffs for revert commits                         | No            |
| 4    | + Referenced GitHub issues (default)               | Yes           |
| 5    | + Diffs for all commits with annotation extraction | No            |

Without `gh`, tiers 2 and 4 are skipped automatically.

### Decision Evolution

After extracting stories, use `evolve_stories.py` to build a decision evolution graph — identifying how decisions relate across stories (supersession, reinforcement, contradiction, specialization):

```bash
python3 scripts/evolve_stories.py results.json --output curated.json
python3 scripts/evolve_stories.py results.json --dry-run        # preview only
python3 scripts/evolve_stories.py results.json --buckets-only   # show file-overlap buckets
```

## Development

```bash
# Watch mode (auto-rebuild on file changes)
npm run dev

# Build TypeScript to JavaScript
npm run build

# Clean build artifacts
npm run clean

# Run the MCP server directly
npm start
```

### Testing the MCP Server

To test the MCP server without integrating it into an AI assistant:

1. Build the project: `npm run build`
2. Run the server: `npm start`
3. The server communicates via stdio (standard input/output)
4. You can send MCP protocol messages via stdin to test tool functionality

### Development Tips

- Use `npm run dev` to auto-rebuild during development
- Check stderr for server logs (stdout is reserved for MCP protocol)
- Ensure Kawa Code is running before testing

## Architecture

```
Claude Code / Cursor AI
    ↓ MCP Protocol (stdio)
kawa.mcp (this server)
    ↓ Huginn IPC (Unix socket / Named pipe)
Kawa Code Desktop App
    ├─ Gardener Module (Rust)
    │   └─ Intent/Decision storage
    └─ HTTP Client
        ↓ REST + SSE
    Kawa API (cloud)
        └─ Team sync & encryption
```

The MCP server communicates with Kawa Code using the Huginn IPC protocol:
- **Context queries**: Intents, decisions, relevant context
- **Intent operations**: Create, update, assign blocks, complete
- **Decision tracking**: Record, retrieve, edit, conflict detection

Kawa Code's Gardener module handles all git operations, diff generation, and local storage of encrypted data.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTION.md) and [CLA.md](CLA.md).

## License

This project is source-available under the
Kawa Code Source Available License.

You may run and modify the software for personal or internal use.

See [LICENSE](LICENSE) for details.

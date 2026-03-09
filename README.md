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

## Prerequisites

### Required

- **Node.js >= 18.0.0** — runtime for the MCP server
- **[Kawa Code](https://codeawareness.com/product) desktop app running** — kawa.mcp is a thin MCP-to-IPC adapter; all git operations, storage, and API communication happen in Kawa Code
- **Active Kawa Code account** — for cloud sync and team features

### Optional (for history inference)

- **Anthropic API key** — your own Claude API key, passed as a parameter to the inference tools
- **[GitHub CLI (`gh`)](https://cli.github.com/)** — enables richer data tiers (PR descriptions, review comments, issue discussions). Without `gh`, tiers 2 and 4 are skipped automatically

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

### History Inference

| Tool               | Description                                                            |
|--------------------|------------------------------------------------------------------------|
| `infer_history`    | Analyze git commit history to extract development stories and decisions |
| `evolve_decisions` | Build a decision evolution graph from previously extracted stories       |

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

## History Inference

Two MCP tools analyze git commit history to extract structured development knowledge — useful for bootstrapping a repository with historical context.

### `infer_history`

Runs a two-pass LLM pipeline on git commit history:

- **Pass 1**: Groups commits into coherent development stories with value hints (high/low/none)
- **Pass 2**: Deep analysis of high/low-value stories to extract architectural decisions and lessons learned

The pipeline runs asynchronously inside Kawa Code. Progress is shown in the Kawa Code desktop app via a progress bar. The pipeline supports checkpointing — if interrupted, re-running resumes from where it left off.

**Usage in Claude Code:**

```
Use the infer_history tool with estimateOnly: true to preview the cost first,
then run it with estimateOnly: false.
```

**Parameters:**

| Parameter              | Type    | Default                    | Description                                                            |
|------------------------|---------|----------------------------|------------------------------------------------------------------------|
| `repoPath`             | string  | *(required)*               | Local path to the repository root                                      |
| `apiKey`               | string  | *(required)*               | Your Anthropic API key                                                 |
| `commits`              | number  | 50                         | Number of recent commits to analyze                                    |
| `tier`                 | number  | 4                          | Data enrichment tier (1-5, see below)                                  |
| `model`                | string  | claude-sonnet-4-20250514   | Anthropic model to use                                                 |
| `maxStories`           | number  | 0                          | Limit stories to analyze in Pass 2 (0 = unlimited)                     |
| `allowCommitSplitting` | boolean | false                      | Allow splitting a commit into multiple stories when it contains unrelated changes (recommended for repos with messy commit history) |
| `contextIssues`        | boolean | false                      | Include context issues from commit date range (tier 4 only)            |
| `estimateOnly`         | boolean | false                      | Preview token cost without running the pipeline                        |

### `evolve_decisions`

Builds a decision evolution graph from previously extracted stories — identifying how decisions relate across stories over time:

1. **Bucketing**: Groups stories by file overlap and keyword similarity
2. **Edge classification**: Uses LLM to identify relationships (supersedes, reinforces, contradicts, specializes)
3. **Annotation**: Labels each decision as stable, orphan, evolved, or abandoned
4. **Curation**: Keeps stable + orphan decisions, drops evolved + abandoned

**Parameters:**

| Parameter | Type   | Default                       | Description                                     |
|-----------|--------|-------------------------------|-------------------------------------------------|
| `stories` | array  | *(required)*                  | Story objects from a previous `infer_history` run |
| `apiKey`  | string | *(required)*                  | Your Anthropic API key                           |
| `model`   | string | claude-haiku-4-5-20251001     | Anthropic model (cheaper model recommended)      |

### Data Tiers

Each tier adds more context for better inference. Higher tiers require the [`gh` CLI](https://cli.github.com/) authenticated.

| Tier | Data source                                        | Requires `gh` |
|------|----------------------------------------------------|---------------|
| 1    | Commit messages + numstat                          | No            |
| 2    | + PR descriptions and review comments              | Yes           |
| 3    | + Diffs for revert commits                         | No            |
| 4    | + Referenced GitHub issues (default)               | Yes           |
| 5    | + Diffs for all commits with annotation extraction | No            |

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

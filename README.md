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

## Prerequisites

### Required

- **Node.js >= 18.0.0** — runtime for the MCP server
- **[Kawa Code](https://kawacode.ai) desktop app running** — kawa.mcp is a thin MCP-to-IPC adapter; all git operations, storage, and API communication happen in Kawa Code

### Optional (for history inference)

- **Anthropic API key** — your own Claude API key, passed as a parameter to the inference tools
- **[GitHub CLI (`gh`)](https://cli.github.com/)** — enables richer data tiers (PR descriptions, review comments, issue discussions). Without `gh`, tiers 2 and 4 are skipped automatically

## Installation

Add the MCP in your AI configuration, for example on Claude Code:

`claude mcp add -s user kawa-intents -- npx -y @kawacode/mcp`

For Cursor AI, install the MCP with `npm install -g @kawacode/mcp` and add it to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "kawa-intents": {
      "command": "kawacode-mcp"
    }
  }
}
```

Note that the MCP will not be automatically updated to future versions in this scenario.
To upgrade to a newer release, run `npm update -g @kawacode/mcp`.

## Manual Installation

For the project you want Kawa Code to run on, create a `.mcp.json` file in your project root (recommended for teams — commit it to git):

```json
{
  "mcpServers": {
    "kawa-intents": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@kawacode/mcp"]
    }
  }
}
```

## Usage

The MCP server works together with the Kawa Code application, Kawa Code IDE extensions, and AI code generators such as Cursor AI and Claude Code.

## Key Features

- **Context Persistence**: Never lose track of what you were working on across AI sessions
- **Smart Context Retrieval**: Relevance-based context loading - only fetch what's needed for the current task
- **Zero-Knowledge Encryption**: Code blocks encrypted client-side before cloud sync, API cannot decrypt
- **Team Conflict Detection**: Know when teammates are working on the same files/lines
- **Decision Tracking**: Record architectural decisions with constraint validation and conflict detection
- **Commit Integration**: Link all code changes to intent context for better git history
- **Cross-Platform**: Works with Claude Code and Cursor AI via MCP protocol

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
    └─ HTTP Client
        ↓ REST + SSE
    Kawa API (cloud)
        └─ Team sync & zero-knowledge encryption
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTION.md) and [CLA.md](CLA.md).

## License

This project is source-available under the
Kawa Code Source Available License.

You may run and modify the software for personal or internal use.

See [LICENSE](LICENSE) for details.

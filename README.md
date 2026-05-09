# Kawa Code MCP

> Team-aware memory for AI coding assistants. Track intent, record decisions, and see when a teammate is editing the same code — in real time, before commit.

`@kawacode/mcp` is the official [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Kawa Code](https://kawacode.ai). It lets Claude Code, Cursor, and any MCP-compatible AI assistant:

- **Remember what you're working on** across sessions, branches, and machines — no more re-explaining the architecture every morning.
- **Surface team conflicts before they happen** — know when a teammate is editing the same file or function in their working copy *right now*, before either of you commits.
- **Capture architectural decisions with their reasoning** — future you (and future AI sessions) inherit the team's accumulated context instead of relitigating choices.
- **Link commits to intent automatically** — every commit gets the *why* attached, not just the diff.

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

- **Real-time team conflict detection** — see when a teammate is editing the same files or lines in their working copy, *before either of you commits*. Most version-control tooling shows you this after the merge conflict; Kawa shows you before.
- **Cross-session AI memory** — your AI assistant picks up where it left off across days, branches, and machines. No re-explaining the architecture every morning.
- **Decision history with reasoning** — record forks, trade-offs, and abandoned approaches with their *why*. Future sessions and teammates inherit the context instead of re-deriving it.
- **Commit ↔ intent linkage** — every commit is automatically associated with the intent that drove it. `git log` shows what changed; Kawa shows why.
- **Smart context retrieval** — relevance-based loading; only what the current task needs.
- **Zero-knowledge encryption** — code blocks encrypted client-side before sync. The Kawa cloud cannot decrypt your team's code.
- **Cross-platform** — works with Claude Code, Cursor, and any MCP-compatible AI assistant.

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

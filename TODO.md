# kawa.mcp — TODO

## Feature requests

### `list_team_intents`: add `limit`, `sort`, and `since` parameters

**Status:** open

**Problem.** `list_team_intents` currently returns *every* intent for a repo
matching the optional `status` filter, with no way to paginate or order the
result. On any non-trivial repo (e.g. `kawa.muninn` with ~200 intents,
`kawa.api` with ~280) the JSON response exceeds the MCP / Claude tool result
size cap and is dumped to a side file, forcing callers to grep / jq through
it. There's no way to ask for "the latest N intents" or "intents updated
since timestamp T".

**Proposal.** Add three optional parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` | `100` | Max number of intents to return. Cap at e.g. 500. |
| `sort` | `"updatedAt-desc" \| "updatedAt-asc" \| "createdAt-desc" \| "createdAt-asc"` | `"updatedAt-desc"` | Order. Default = newest-updated first. |
| `since` | `string` (ISO 8601 timestamp) | none | Only return intents whose `updatedAt` is `>= since`. |

**Example uses unblocked by this:**

```jsonc
// "what's the user been working on most recently?"
{ "limit": 10, "sort": "updatedAt-desc" }

// "show me everything since I last checked"
{ "since": "2026-04-08T00:00:00Z" }

// "first 50 active intents, oldest first" — for pagination
{ "status": "active", "limit": 50, "sort": "createdAt-asc" }
```

**Why we hit this.** Verifying the latest 2 intents per repo against
production MongoDB during a session — `list_team_intents` returned 116KB
for `kawa.muninn` and 163KB for `kawa.api`, both blowing past the tool
result cap. Worked around it by writing to a side file and jq-filtering,
which is fragile.

**Implementation notes.**
- The tool reads from local storage (not the API), so server-side
  pagination isn't relevant — the filtering happens in the MCP server's
  in-memory list. Cheap.
- `sort` defaults match the most common "what's recent?" question.
- `limit` should be enforced as an upper bound (not a hint) so callers
  can't accidentally blow the size cap by passing a huge value.
- Keep `status` filter as-is. The new params compose with it.

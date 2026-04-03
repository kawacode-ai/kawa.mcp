import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const getRelevantContextSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  prompt: z.string().describe('The user request to find relevant context for'),
  activeFiles: z.array(z.string()).optional().describe('Files currently being discussed or recently opened'),
  maxIntents: z.number().optional().default(10).describe('Maximum number of intents to return'),
  maxDecisions: z.number().optional().default(10).describe('Maximum number of decisions to return'),
  minRelevance: z.number().optional().default(0.3).describe('Minimum relevance score (0-1)')
})

export type GetRelevantContextInput = z.infer<typeof getRelevantContextSchema>

export interface ScoredIntent {
  id: string
  title: string
  description: string
  status: string
  templateType: string
  score: number
}

export interface ScoredDecision {
  id: string
  intentId: string
  intentIds: string[]
  type: string
  summary: string
  rationale: string
  relatedFiles: string[]
  hasViolations: boolean
  score: number
}

export interface GetRelevantContextResponse {
  projectOrigin: string
  projectPath: string
  relevantIntents: ScoredIntent[]
  relevantDecisions: ScoredDecision[]
  summary: {
    totalIntentsSearched: number
    totalDecisionsSearched: number
    intentsReturned: number
    decisionsReturned: number
  }
  error?: string
}

const EMPTY_RESPONSE = (origin: string, path: string): GetRelevantContextResponse => ({
  projectOrigin: origin,
  projectPath: path,
  relevantIntents: [],
  relevantDecisions: [],
  summary: {
    totalIntentsSearched: 0,
    totalDecisionsSearched: 0,
    intentsReturned: 0,
    decisionsReturned: 0,
  },
})

export async function getRelevantContext(input: GetRelevantContextInput): Promise<GetRelevantContextResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  let res: any
  try {
    res = await request('search', 'context', {
      origin: actualOrigin,
      query: input.prompt,
      activeFiles: input.activeFiles || [],
      maxIntents: input.maxIntents,
      maxDecisions: input.maxDecisions,
      minScore: input.minRelevance,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    return { ...EMPTY_RESPONSE(actualOrigin, input.repoPath), error: `Muninn unavailable: ${msg}` }
  }

  return {
    projectOrigin: actualOrigin,
    projectPath: input.repoPath,

    relevantIntents: (res.intents || []).map((i: any) => ({
      id: i._id || i.id || '',
      title: i.title || '',
      description: i.description || '',
      status: i.status || 'active',
      templateType: i.templateType || i.template_type || 'feature',
      score: i.score || 0,
    })),

    relevantDecisions: (res.decisions || []).map((d: any) => ({
      id: d.decisionId || d.decision_id || '',
      intentId: d.intentId || d.intent_id || d.intentIds?.[0] || d.intent_ids?.[0] || '',
      intentIds: d.intentIds || d.intent_ids || (d.intentId || d.intent_id ? [d.intentId || d.intent_id] : []),
      type: d.decisionType || d.decision_type || d.type || '',
      summary: d.summary || '',
      rationale: d.rationale || '',
      relatedFiles: d.relatedFiles || d.related_files || [],
      hasViolations: (d.constraintViolations || d.constraint_violations || []).length > 0,
      score: d.score || 0,
    })),

    summary: {
      totalIntentsSearched: res.summary?.totalIntents || 0,
      totalDecisionsSearched: res.summary?.totalDecisions || 0,
      intentsReturned: (res.intents || []).length,
      decisionsReturned: (res.decisions || []).length,
    }
  }
}

export const getRelevantContextTool = {
  name: 'get_relevant_context',
  description: `Find context relevant to a specific user request.

Use this when you need context that's specifically relevant to the current task,
rather than all recent context. This is more token-efficient for large projects.

**IMPORTANT: Call this AFTER initial exploration of the request**, not immediately.
Once you know which files are involved, pass them in \`activeFiles\` for much better
relevance matching. A vague prompt alone yields poor results.

The tool:
1. Sends your prompt to the API for semantic embedding
2. Computes cosine similarity against stored embeddings for all intents and decisions
3. Uses \`activeFiles\` to boost items with matching file paths
4. Returns only the most relevant items above the minimum score threshold

**Recommended workflow:**
1. \`check_active_intent\` at SESSION START (resume existing work)
2. Explore the user's request (read files, understand scope)
3. \`get_relevant_context\` with prompt + activeFiles (task-specific context)

Returns:
- **relevantIntents**: Past work related to the current task
- **relevantDecisions**: Decisions affecting similar code/concepts (both intent-scoped and repo-scoped)

Example: User asks "Add validation to user registration endpoint"
After exploring, you found src/routes/user.ts and src/validators/
Call with: prompt + activeFiles: ["src/routes/user.ts", "src/validators/user.ts"]
Returns intents/decisions matching these files and keywords`,
  inputSchema: getRelevantContextSchema,
  handler: getRelevantContext
}

import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const getProjectDecisionsSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root')
})

export type GetProjectDecisionsInput = z.infer<typeof getProjectDecisionsSchema>

export interface ConstraintViolation {
  alternative: string
  constraint: string
  reason: string
}

export interface ProjectDecision {
  intentId: string
  id: string
  timestamp: string
  type: 'fork' | 'abandoned' | 'discovery' | 'constraint' | 'tradeoff' | 'dependency'
  summary: string
  rationale: string
  context?: string
  alternatives: string[]
  consequences?: string
  relatedFiles: string[]
  constraintsChecked: string[]
  constraintViolations: ConstraintViolation[]
}

export interface GetProjectDecisionsResponse {
  decisions: ProjectDecision[]
  count: number
}

export async function getProjectDecisions(input: GetProjectDecisionsInput): Promise<GetProjectDecisionsResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)
  const res = await request('decision', 'project-list', {
    repoOrigin: actualOrigin,
  })

  const decisions: ProjectDecision[] = (res.decisions || []).map((d: any) => ({
    intentId: d.intent_id || d.intentId || '',
    id: d.decision_id || d.decisionId || d._id || d.id || '',
    timestamp: d.timestamp || d.created_at || d.createdAt || '',
    type: d.decision_type || d.decisionType || d.type,
    summary: d.summary || '',
    rationale: d.rationale || '',
    context: d.context,
    alternatives: d.alternatives || [],
    consequences: d.consequences,
    relatedFiles: d.related_files || d.relatedFiles || [],
    constraintsChecked: d.constraints_checked || d.constraintsChecked || [],
    constraintViolations: d.constraint_violations || d.constraintViolations || []
  }))

  return {
    decisions,
    count: decisions.length
  }
}

export const getProjectDecisionsTool = {
  name: 'get_project_decisions',
  description: `Get all decisions recorded for a project across all intents.

Use this to review the project's decision history:
- See what architectural decisions have been made
- Understand past trade-offs and their rationale
- Find decisions affecting specific files
- Review constraint violations that were avoided

Returns:
- decisions: Array of decisions with their intent context
- count: Total number of decisions

Each decision includes:
- intentId: The intent this decision belongs to
- type: fork, abandoned, discovery, constraint, tradeoff, or dependency
- summary: Brief description of the decision
- rationale: Why this decision was made
- relatedFiles: Files affected by this decision
- constraintViolations: Options that were rejected due to constraints`,
  inputSchema: getProjectDecisionsSchema,
  handler: getProjectDecisions
}

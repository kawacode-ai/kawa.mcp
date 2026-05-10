/**
 * Phase 0 of the pre-edit decision check (kawa.dev-doc/PRE_EDIT_DECISION_CHECK.md §Phase 0).
 *
 * Pure data shapes for the offline trigger evaluator. The evaluator is given
 * pre-fetched tier inputs and decides whether/how to surface a warning.
 *
 * Phases 1+ wire IPC and the MCP tool surface around these shapes — see the
 * plan for the full response schema.
 */

/** All decision types tracked by the system. Mirrors src/tools/record-decision.ts. */
export type DecisionType =
  | 'fork'
  | 'abandoned'
  | 'discovery'
  | 'constraint'
  | 'tradeoff'
  | 'dependency'

/**
 * Decision types that promote a Tier 1a hit to block-mode in Phase 3.
 * Per plan §Phase 3 + decision #2: only Tier 1a + {constraint, abandoned} blocks.
 */
export const BLOCK_TRIGGER_DECISION_TYPES: ReadonlySet<DecisionType> = new Set([
  'constraint',
  'abandoned',
])

/** A decision surfaced by either tier. */
export interface DecisionRecord {
  decisionId: string
  intentId: string
  summary: string
  rationale: string
  type: DecisionType
}

/** An intent whose blocks overlap the touched line range (Tier 1a). */
export interface OverlappingIntent {
  intentId: string
  title: string
  blockStartLine: number
  blockEndLine: number
  overlapStart: number
  overlapEnd: number
}

/**
 * Inputs for the evaluator. Phase 1's MCP tool layer is responsible for
 * fetching the tier data and supersedes sets via IPC; the evaluator stays pure.
 */
export interface EvaluatorInput {
  /** Intents whose blocks overlap the touched lines. */
  tier1aIntents: OverlappingIntent[]
  /**
   * Decisions associated with the Tier 1a intents (pre-fetched).
   * The filter pipeline runs over these.
   */
  tier1aDecisions: DecisionRecord[]
  /** Decisions whose relatedFiles include the touched file (file-anchored). */
  tier1bDecisions: DecisionRecord[]
  activeIntentSupersedes: ReadonlySet<string>
  repoScopedSupersedes: ReadonlySet<string>
  sessionForceOverrides: ReadonlySet<string>
}

/** Diagnostic listing of which decision IDs each filter mechanism dropped. */
export interface FilteredDiagnostic {
  activeIntentSupersedes: string[]
  repoScopedSupersedes: string[]
  sessionForceOverrides: string[]
}

export type Tier = '1a' | '1b'

/**
 * Recommendation maps to the Phase 3 hook output mode:
 *  - "proceed"             → silent (no output)
 *  - "review"              → advisory (exit 0 + JSON to stdout)
 *  - "investigate-upstream" → block (exit 2)
 */
export type Recommendation = 'proceed' | 'review' | 'investigate-upstream'

/** Plan §2 response shape, minus the IPC-specific fields wired in Phase 1. */
export interface EvaluatorOutput {
  triggered: boolean
  tier: Tier | null
  /** Tier 1a only — overlapping intents with their block ranges. */
  intents?: OverlappingIntent[]
  /** Tier 1a (filtered associated decisions) or Tier 1b (filtered file decisions). */
  decisions?: DecisionRecord[]
  filtered: FilteredDiagnostic
  recommendation: Recommendation
}

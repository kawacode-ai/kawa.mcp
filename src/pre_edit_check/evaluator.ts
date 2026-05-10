/**
 * Phase 0 trigger evaluator (kawa.dev-doc/PRE_EDIT_DECISION_CHECK.md §Phase 0).
 *
 * Pure functions only. No IPC, no I/O. Phase 1 wraps these in an MCP tool.
 *
 * Pipeline (per plan §1):
 *
 *   filtered = touched_region_decisions
 *            \ active_intent_supersedes      // permanent within the active intent
 *            \ repo_scoped_supersedes        // persistent across intents
 *            \ session_force_overrides       // one-off `force: true` bypasses
 *
 * Tier dispatch is short-circuiting: Tier 1a (line-overlap) wins over Tier 1b
 * (file-overlap) when non-empty. Both empty → silent.
 *
 * Tier 1a triggers on intent overlap regardless of surviving decisions — the
 * overlap itself is information ("another intent owns these lines"). The
 * decision filter only governs whether the recommendation is "review" or
 * "investigate-upstream" (the block trigger).
 *
 * Tier 1b triggers only when at least one decision survives the filter — a
 * file-level hit with no surviving rationale carries no signal.
 */

import {
  BLOCK_TRIGGER_DECISION_TYPES,
  type DecisionRecord,
  type EvaluatorInput,
  type EvaluatorOutput,
  type FilteredDiagnostic,
  type Recommendation,
  type Tier,
} from './types.js'

interface PipelineResult {
  surviving: DecisionRecord[]
  diagnostic: FilteredDiagnostic
}

function applyFilterPipeline(
  decisions: DecisionRecord[],
  activeIntentSupersedes: ReadonlySet<string>,
  repoScopedSupersedes: ReadonlySet<string>,
  sessionForceOverrides: ReadonlySet<string>,
): PipelineResult {
  const diagnostic: FilteredDiagnostic = {
    activeIntentSupersedes: [],
    repoScopedSupersedes: [],
    sessionForceOverrides: [],
  }
  const surviving: DecisionRecord[] = []

  for (const d of decisions) {
    if (activeIntentSupersedes.has(d.decisionId)) {
      diagnostic.activeIntentSupersedes.push(d.decisionId)
      continue
    }
    if (repoScopedSupersedes.has(d.decisionId)) {
      diagnostic.repoScopedSupersedes.push(d.decisionId)
      continue
    }
    if (sessionForceOverrides.has(d.decisionId)) {
      diagnostic.sessionForceOverrides.push(d.decisionId)
      continue
    }
    surviving.push(d)
  }

  return { surviving, diagnostic }
}

function deriveRecommendation(
  triggered: boolean,
  tier: Tier | null,
  survivingDecisions: DecisionRecord[],
): Recommendation {
  if (!triggered) return 'proceed'
  if (tier === '1a' && survivingDecisions.some(d => BLOCK_TRIGGER_DECISION_TYPES.has(d.type))) {
    return 'investigate-upstream'
  }
  return 'review'
}

function emptyDiagnostic(): FilteredDiagnostic {
  return {
    activeIntentSupersedes: [],
    repoScopedSupersedes: [],
    sessionForceOverrides: [],
  }
}

export function evaluate(input: EvaluatorInput): EvaluatorOutput {
  // Tier 1a: line-precise > file-coarse. Short-circuit Tier 1b on any overlap.
  if (input.tier1aIntents.length > 0) {
    const { surviving, diagnostic } = applyFilterPipeline(
      input.tier1aDecisions,
      input.activeIntentSupersedes,
      input.repoScopedSupersedes,
      input.sessionForceOverrides,
    )
    return {
      triggered: true,
      tier: '1a',
      intents: input.tier1aIntents,
      decisions: surviving,
      filtered: diagnostic,
      recommendation: deriveRecommendation(true, '1a', surviving),
    }
  }

  // Tier 1b: only triggers if at least one decision survives the filter.
  const { surviving, diagnostic } = applyFilterPipeline(
    input.tier1bDecisions,
    input.activeIntentSupersedes,
    input.repoScopedSupersedes,
    input.sessionForceOverrides,
  )

  if (surviving.length === 0) {
    // Either no Tier 1b retrieval, or the filter pipeline removed everything.
    // Both collapse to silent per plan §Phase 3.
    return {
      triggered: false,
      tier: null,
      filtered: input.tier1bDecisions.length > 0 ? diagnostic : emptyDiagnostic(),
      recommendation: 'proceed',
    }
  }

  return {
    triggered: true,
    tier: '1b',
    decisions: surviving,
    filtered: diagnostic,
    recommendation: deriveRecommendation(true, '1b', surviving),
  }
}

export { applyFilterPipeline, deriveRecommendation }

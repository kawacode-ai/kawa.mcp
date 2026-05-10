/**
 * Compute the two supersedes sets the Phase 0 evaluator filters by.
 *
 * Plan ref: kawa.dev-doc/PRE_EDIT_DECISION_CHECK.md §1.
 *
 * - **activeIntentSupersedes** — decision IDs the active intent has overridden.
 *   Permanent within the intent's scope; per the plan, "once the user has
 *   overridden a constraint within the intent, re-surfacing adds friction
 *   without signal."
 * - **repoScopedSupersedes** — decision IDs overridden via repo-scoped fork
 *   decisions (those recorded with intentId=''). Persistent across intents
 *   per the plan: "explicitly persistent guidance and apply across intents."
 *
 * Source: each `record_decision` call may include a `supersedes: string[]`
 * array of decision IDs being superseded. We union those arrays across
 * decisions, partitioned by their `intentId`.
 *
 * Pure function — no IPC, no I/O. Takes a snapshot of the repo's decisions
 * (typically from `decision:project-list`) and a known active intent ID.
 */

/** Minimal decision shape the helper needs. Tolerates the snake_case /
 *  camelCase variants that flow through the IPC layer. */
export interface DecisionForSupersedes {
  /** Owning intent. `''` for repo-scoped decisions. */
  intentId?: string
  /** Snake-case alias as returned by some Muninn paths. */
  intent_id?: string
  /** When a decision spans multiple intents (post-evolve). First non-empty wins. */
  intentIds?: string[]
  intent_ids?: string[]
  /** Decision IDs this one supersedes. Optional — most decisions don't carry it. */
  supersedes?: string[]
}

export interface SupersedesSets {
  activeIntentSupersedes: Set<string>
  repoScopedSupersedes: Set<string>
}

function resolveIntentId(d: DecisionForSupersedes): string {
  if (d.intentId && d.intentId.length > 0) return d.intentId
  if (d.intent_id && d.intent_id.length > 0) return d.intent_id
  const fromList = d.intentIds?.[0] ?? d.intent_ids?.[0]
  return fromList ?? ''
}

export function computeSupersedes(
  decisions: readonly DecisionForSupersedes[],
  activeIntentId: string,
): SupersedesSets {
  const activeIntentSupersedes = new Set<string>()
  const repoScopedSupersedes = new Set<string>()

  for (const d of decisions) {
    if (!d.supersedes || d.supersedes.length === 0) continue
    const owningIntent = resolveIntentId(d)

    if (activeIntentId.length > 0 && owningIntent === activeIntentId) {
      for (const id of d.supersedes) activeIntentSupersedes.add(id)
    } else if (owningIntent === '') {
      for (const id of d.supersedes) repoScopedSupersedes.add(id)
    }
    // Decisions belonging to other intents are ignored — per plan, "Cross-intent
    // supersedes don't leak: a completed intent's overrides apply only within
    // its own scope; new work re-records the override to claim it."
  }

  return { activeIntentSupersedes, repoScopedSupersedes }
}

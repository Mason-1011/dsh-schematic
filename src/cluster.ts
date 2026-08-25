/**
 * Seam clustering over live mount nodes.
 *
 * A cluster is ONE capability seam: the provider of a ctx key plus the units
 * whose primary relationship is that key (their top provided key, else their
 * top injected key). No transitive merging — the static scanner's union-find
 * chains adjacent seams together, which on a dense live profile (the web
 * composition) collapses 80+ units into one component. A unit whose keys are
 * all infrastructure (agents, llm, tools…) stays a singleton so the spine
 * remains visible.
 */

/** Node fields clustering consumes (superset fields are ignored). */
export interface ClusterNode {
  id: string
  provides: string[]
  inject: string[]
  desc: string | null
}

/** A capability seam cluster: label key, intro line, and member node ids. */
export interface Cluster {
  id: string
  label: string
  /** The provider unit that seeds the cluster; owns the desc and category. */
  provider: string
  desc: string | null
  seamKeys: string[]
  members: string[]
}

const UNIVERSAL_MIN = 9

/**
 * Group units into seam clusters.
 * @param nodes - every mounted unit.
 * @param edges - aggregated injector→provider edges with the ctx keys they ride.
 * @param keyInjectCount - injector count per ctx key (drives the universal test and ranking).
 * @param infraKeys - infrastructure keys that never drive clustering regardless of count.
 * @returns clusters (>= 2 members) plus the universal key list for the snapshot meta.
 */
export function buildClusters(
  nodes: ClusterNode[],
  edges: { from: string; to: string; keys: string[] }[],
  keyInjectCount: Map<string, number>,
  infraKeys: ReadonlySet<string> = new Set(),
): { clusters: Cluster[]; universalKeys: string[] } {
  const isUniversal = (k: string) => infraKeys.has(k) || (keyInjectCount.get(k) ?? 0) >= UNIVERSAL_MIN
  const byRank = (a: string, b: string) => (keyInjectCount.get(b) ?? 0) - (keyInjectCount.get(a) ?? 0)

  // live ownership is single-provider per key (the reflect store holds the
  // outermost Impl), so edges carry each key's owner exactly once
  const keyOwner = new Map<string, string>()
  for (const e of edges) for (const k of e.keys) keyOwner.set(k, e.to)

  // cluster seed: provider node → its label key (top non-universal provided key)
  const seedKey = new Map<string, string>()
  for (const n of nodes) {
    const own = n.provides.filter((k) => !isUniversal(k) && keyOwner.get(k) === n.id).sort(byRank)[0]
    if (own) seedKey.set(n.id, own)
  }

  const groups = new Map<string, { label: string; members: Set<string> }>()
  const groupOf = (providerId: string, key: string): { label: string; members: Set<string> } => {
    if (!groups.has(providerId)) groups.set(providerId, { label: key, members: new Set([providerId]) })
    return groups.get(providerId)!
  }
  for (const n of nodes) {
    const own = seedKey.get(n.id)
    if (own) { groupOf(n.id, own); continue }
    const dep = n.inject.filter((k) => !isUniversal(k) && keyOwner.has(k)).sort(byRank)[0]
    if (dep) groupOf(keyOwner.get(dep)!, dep).members.add(n.id)
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const clusters: Cluster[] = []
  for (const [providerId, group] of groups) {
    if (group.members.size < 2) continue
    const provider = byId.get(providerId)!
    clusters.push({
      id: `cluster:${group.label}`,
      label: group.label,
      provider: providerId,
      desc: provider.desc,
      seamKeys: provider.provides.filter((k) => !isUniversal(k)).sort(byRank),
      members: [...group.members].sort(),
    })
  }
  const universalKeys = [...new Set([
    ...infraKeys,
    ...[...keyInjectCount.entries()].filter(([, v]) => v >= UNIVERSAL_MIN).map(([k]) => k),
  ])].sort()
  return { clusters, universalKeys }
}

/**
 * Longest-injector-path rank (0 = no injectors), relaxed to a fixed point and
 * capped at 12 — the column index for the layout.
 */
export function computeRank(
  nodes: { id: string; rank?: number }[],
  edges: { from: string; to: string }[],
): Map<string, number> {
  const rank = new Map(nodes.map((n) => [n.id, 0]))
  const incomers = new Map(nodes.map((n) => [n.id, [] as string[]]))
  for (const e of edges) incomers.get(e.to)?.push(e.from)
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false
    for (const n of nodes) {
      const deps = incomers.get(n.id) ?? []
      const r = deps.length ? Math.max(...deps.map((d) => (rank.get(d) ?? 0) + 1)) : 0
      const next = Math.min(r, 12)
      if (next !== rank.get(n.id)) { rank.set(n.id, next); changed = true }
    }
    if (!changed) break
  }
  return rank
}

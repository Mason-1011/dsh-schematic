/**
 * RPC-gateway observer: every web-UI action a user can take rides one of the
 * apiProxy sub-API methods (POST /api/<method> → api.<group>.<method>), and
 * none of them append a session event — registry-level operations like
 * workspace.archiveSession deliberately never touch any session log. Watching
 * the session-event firehose alone therefore cannot see them.
 *
 * This module wraps the tracked mutation methods with an instrumented
 * pass-through (reflect.get, no inject — an observer must not grow topology
 * edges). The wrapper is behavior-neutral: same arguments, same `this`, the
 * original's result or rejection forwarded untouched; the only addition is a
 * callback after settlement. Read-only methods are not wrapped at all.
 *
 * The apiProxy service can be remounted (HMR); ensure() re-checks identity,
 * so callers re-run it at cheap natural points (SSE connect, graph rebuild).
 */

import type { Context } from '@deepseek-ai/cordis'
import { RPC_ACTION } from './attribution.ts'

/** apiProxy sub-API property → wire method prefix, mirroring the harness rpc-map. */
const SUB_API_PREFIX: Record<string, string> = {
  sessions: 'session.',
  subagents: 'subagent.',
  host: 'host.',
  workspace: 'workspace.',
  skills: 'skill.',
  agentPresets: 'agentPreset.',
  goals: 'goal.',
  settings: 'settings.',
  credentials: 'credentials.',
  llm: 'llm.',
}

/** Marks wrapped functions so ensure() never double-wraps. */
const WRAPPED = Symbol('dsh-schematic-wrapped')

/** Structural slice of the apiProxy service (out-of-tree: no type import). */
interface ApiProxySlice {
  [group: string]: unknown
}

export interface ActionReporter {
  /**
   * Called after one tracked RPC mutation settles; must not throw.
   * @param method wire method name, e.g. 'workspace.archiveSession'
   * @param isError true when the call rejected
   * @param durationMs wall time from call to settlement
   */
  (method: string, isError: boolean, durationMs: number): void
}

export interface RpcObserver {
  /** Wrap the current apiProxy instance if it is not the wrapped one yet. */
  ensure(): void
  /** Restore every wrapped method (plugin dispose). */
  dispose(): void
}

export function installRpcObserver(ctx: Context, onAction: ActionReporter): RpcObserver {
  const restores = new Set<() => void>()
  let wrappedService: unknown

  const ensure = (): void => {
    const reflect = ctx.reflect as unknown as { get(name: string): unknown }
    const svc = reflect.get('apiProxy') as ApiProxySlice | undefined
    if (svc === undefined || svc === wrappedService) return
    dispose()
    wrappedService = svc
    for (const [group, prefix] of Object.entries(SUB_API_PREFIX)) {
      const subApi = svc[group]
      if (subApi === null || typeof subApi !== 'object') continue
      for (const [prop, value] of Object.entries(subApi)) {
        const method = prefix + prop
        if (typeof value !== 'function'
          || !Object.prototype.hasOwnProperty.call(RPC_ACTION, method)
          || (value as { [WRAPPED]?: boolean })[WRAPPED] === true) continue
        const original = value as (...args: unknown[]) => unknown
        const holder = subApi as Record<string, unknown>
        const wrapped = function (this: unknown, ...args: unknown[]): unknown {
          const startedAt = Date.now()
          const settle = (isError: boolean): void => {
            try { onAction(method, isError, Math.max(0, Date.now() - startedAt)) } catch { /* observer errors never reach the RPC caller */ }
          }
          const forward = (promise: unknown): unknown =>
            Promise.resolve(promise).then(
              (result) => { settle(false); return result },
              (err) => { settle(true); throw err },
            )
          try {
            return forward(original.apply(this, args))
          } catch (err) {
            settle(true)
            throw err
          }
        }
        const tagged = wrapped as unknown as { [WRAPPED]: boolean }
        tagged[WRAPPED] = true
        holder[prop] = wrapped
        restores.add(() => { if (holder[prop] === wrapped) holder[prop] = original })
      }
    }
  }

  const dispose = (): void => {
    for (const restore of restores) restore()
    restores.clear()
    wrappedService = undefined
  }

  return { ensure, dispose }
}

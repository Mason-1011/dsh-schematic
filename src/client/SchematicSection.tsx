/**
 * React host for the topology engine inside the dsh web SPA: one div ref
 * whose effect mounts the framework-free engine and disposes it on unmount.
 */

import { useEffect, useRef } from 'react'
import { mountSchematic } from './engine.ts'

/** settings.section component: the full viewer, self-contained. */
export function SchematicSection(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    return mountSchematic(host)
  }, [])
  return <div ref={hostRef} className="sch-host" />
}

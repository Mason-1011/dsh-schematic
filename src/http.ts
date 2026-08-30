/**
 * Shared HTTP plumbing for the /schematic host routes.
 *
 * @module dsh-schematic/http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError } from './llm.ts'

/** Largest accepted request body. */
const MAX_BODY_BYTES = 64 * 1024

/** Send one raw response body. */
export function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

/** Send one JSON response body. */
export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json', JSON.stringify(value))
}

/** Read one JSON request body under the size cap. */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new HttpError(413, '请求体过大'))
        return
      }
      parts.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || 'null'))
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON'))
      }
    })
    req.on('error', (err) => reject(new HttpError(400, `读取请求体失败:${err.message}`)))
  })
}

/** 极薄 API 封装：fetch + SSE。 */

export async function get<T = any>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function post<T = any>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as any).error ?? `${res.status}`)
  return json as T
}

export interface EventItem { at: string, kind: string, text: string, segment?: string }

export function connectEvents(onEvent: (item: EventItem) => void): EventSource {
  const source = new EventSource('/api/events')
  source.onmessage = message => {
    try { onEvent(JSON.parse(message.data) as EventItem) } catch { /* 忽略坏帧 */ }
  }
  return source
}

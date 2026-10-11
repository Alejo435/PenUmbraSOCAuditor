import type { FullReport, LogEvent, NodeReport, StateResponse } from '@/types'

// fetch wrapper that parses json and turns http errors into exceptions carrying the server's message
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      body && typeof body.error === 'string' ? body.error : `${response.status} ${response.statusText}`
    throw new Error(message)
  }
  return body as T
}

// every backend endpoint the ui uses. GET /api/logs is deliberately absent because it
// returns events that have not been replayed yet
export const api = {
  getState: () => request<StateResponse>('/api/state'),
  // events ingested so far, oldest first
  getEvents: () => request<LogEvent[]>('/logs'),
  getReport: (index: number) => request<NodeReport>(`/api/reports/${index}`),
  getReports: () => request<NodeReport[]>('/api/reports'),
  start: () => request<{ message: string }>('/api/start', { method: 'POST' }),
  reset: () => request<{ message: string }>('/api/reset', { method: 'POST' }),
  // incident report covering the whole graph. without ai the backend skips gemma and answers at once
  getFullReport: (ai: boolean) =>
  request<FullReport>(`/api/full-report${ai ? '' : '?ai=0'}`, { method: 'POST' }),
  // sends one raw log line straight into the graph, outside the replay
  injectLog: (raw: string) =>
  request<{ message: string }>('/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  }),
}
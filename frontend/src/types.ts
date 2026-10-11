// connection state of the event stream as shown in the header
export type StreamStatus = 'idle' | 'live' | 'standby'

// log level written in the source file. the backend uppercases whatever the file contains,
// so values beyond these three can appear
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | (string & {})

// one parsed log line as returned by GET /logs
export type LogEvent = {
  // iso 8601 utc timestamp from the log file
  timestamp: string
  severity: LogLevel
  // the service that wrote the line, e.g. auth-service or firewall
  source: string
  // event name from the line, e.g. login_failed or process_start
  event: string
  // every key=value pair from the line except event
  fields: Record<string, string>
  // the original line after the timestamp, severity and source
  message: string
  line_number: number
}

export type EntityType = 'user' | 'host' | 'ip' | 'process' | 'file'

export type GraphNode = {
  // type-prefixed key such as ip:192.0.2.10, unique across the graph
  id: string
  type: EntityType
  label: string
  // arrival order of the node, also the key for its report
  index: number
  first_seen: string
  last_seen: string
  count: number
  // 0 to 100, raised each time a detection rule fires for this node
  risk: number
  // names of the detection rules that fired, e.g. brute_force
  flags: string[]
  description: string
  // extra context such as a process command line, empty when absent
  detail: string
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  // what connects the two nodes, e.g. login_failed or tcp/22 blocked
  relation: string
  count: number
  suspicious: boolean
  reason: string
  // position in the attack path when suspicious, otherwise null
  order: number | null
  first_seen: string
  last_seen: string
}

export type AlertSeverity = 'medium' | 'high'

export type Alert = {
  // timestamp of the event that triggered the alert
  timestamp: string
  rule: string
  severity: AlertSeverity
  message: string
  // ids of the graph nodes involved
  entities: string[]
}

export type GraphSnapshot = {
  // increases on every reset, so a change means the graph was cleared
  generation: number
  version: number
  event_count: number
  // events that matched no detection rule and added nothing to the graph
  noise_count: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  alerts: Alert[]
  // ids of suspicious edges in the order they appeared
  attack_path: string[]
}

// the backend's cytoscape elements, used here only for node positions
export type GraphElement = {
  data: { id: string }
  position?: { x: number; y: number }
}

export type ReplayStatus = {
  running: boolean
  finished: boolean
  error: string | null
  processed: number
  total: number
  // simulation clock as HH:MM:SS, with no date
  clock: string
  file: string | null
}

export type ReportsSummary = {
  // gemma when an ai url is configured, rules when running without ai
  mode: 'gemma' | 'rules'
  total: number
  ai_reports: number
  pending: number
  errors: number
}

// response of GET /api/state, the single source of truth polled by the ui
export type StateResponse = {
  snapshot: GraphSnapshot
  elements: GraphElement[]
  replay: ReplayStatus
  recent: Omit<LogEvent, 'message' | 'line_number'>[]
  reports: ReportsSummary
}

export type ReportStatus = 'queued' | 'generating' | 'updating' | 'ready' | 'error'

// response of GET /api/reports/<index>
export type NodeReport = {
  index: number
  node_id: string
  label: string
  type: EntityType
  risk: number
  // plain text with labeled lines followed by a facts block
  report: string
  // who wrote the current text: gemma, the rules engine, or nobody yet
  source: 'gemma' | 'rules' | 'none'
  status: ReportStatus
  version: number
  revision: number
  fails: number
  error: string | null
  updated_at: string
}

export type OverallSeverity = 'low' | 'medium' | 'high' | 'critical'

// response of POST /api/full-report
export type FullReport = {
  // the whole report as github flavored markdown
  report: string
  // who wrote the executive summary
  source: 'gemma' | 'rules'
  // why the ai summary failed when the backend fell back to rules, otherwise null
  error: string | null
  severity: OverallSeverity
  // backend wall-clock time as HH:MM:SS
  generated_at: string
  // name of the copy the backend saved in its reports folder
  file: string
  nodes: number
  alerts: number
  ai_reports: number
}
import type { Alert, LogEvent } from '@/types'

// node ids look like ip:198.51.100.23 or process:workstation-04/powershell.exe,
// so the searchable parts are the pieces after the type prefix
function entityParts(nodeId: string) {
  return nodeId.slice(nodeId.indexOf(':') + 1).split('/')
}

// alerts carry no event reference, so the triggering event is matched by identical
// timestamp plus at least one involved entity appearing in the log line
export function alertsForEvent(event: LogEvent, alerts: Alert[]) {
  return alerts.filter(
    (alert) =>
      alert.timestamp === event.timestamp &&
      alert.entities.some((id) => entityParts(id).some((part) => event.message.includes(part))),
  )
}
import type { Alert, LogEvent } from '@/types'

// node ids look like ip:198.51.100.23 or process:workstation-04/powershell.exe,
// so the searchable parts are the pieces after the type prefix
function entityParts(nodeId: string) {
  // empty pieces from leading slashes in file paths would match every line, so they are dropped
  return nodeId.slice(nodeId.indexOf(':') + 1).split('/').filter(Boolean)
}

// true when at least one of the alert's entities appears in the event's log line
function mentionsEntity(event: LogEvent, alert: Alert) {
  return alert.entities.some((id) => entityParts(id).some((part) => event.message.includes(part)))
}

// links each alert to exactly one event, keyed by the event's index in the list. alerts carry no
// event reference, so candidates must share the alert's timestamp and mention one of its entities.
// when several qualify, the last is chosen, since threshold rules fire on the event that crosses the line
export function alertsByEvent(events: LogEvent[], alerts: Alert[]) {
  const result = new Map<number, Alert[]>()
  for (const alert of alerts) {
    let match = -1
    events.forEach((event, index) => {
      if (event.timestamp === alert.timestamp && mentionsEntity(event, alert)) match = index
    })
    if (match !== -1) result.set(match, [...(result.get(match) ?? []), alert])
  }
  return result
}
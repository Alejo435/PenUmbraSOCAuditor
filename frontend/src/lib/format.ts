// turns identifiers like login_failed into readable words
export function humanize(name: string) {
  return name.replaceAll('_', ' ')
}

// HH:MM:SS from an iso timestamp, which is how times appear throughout the console
export function timeOf(timestamp: string) {
  return timestamp.slice(11, 19)
}
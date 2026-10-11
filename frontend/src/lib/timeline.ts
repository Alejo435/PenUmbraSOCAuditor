import type { LogEvent } from '@/types'

// position of a moment within the visible window, as a percentage clamped to the window
export function percentAt(ms: number, start: number, end: number) {
  if (end <= start) return 100
  return Math.min(100, Math.max(0, ((ms - start) / (end - start)) * 100))
}

// places labels left to right in the first row where they clear the previous label in that row,
// so nearby detections stack into new rows instead of colliding. returns a row number per label
export function assignRows(lefts: number[], minGap: number) {
  const rowEnds: number[] = []
  return lefts.map((left) => {
    let row = rowEnds.findIndex((end) => left - end >= minGap)
    if (row === -1) row = rowEnds.length
    rowEnds[row] = left
    return row
  })
}

// counts events into equal slices of the window, for the activity strip under the axis
export function binEvents(events: LogEvent[], start: number, end: number, bins: number) {
  const counts = new Array<number>(bins).fill(0)
  for (const event of events) {
    const fraction = percentAt(Date.parse(event.timestamp), start, end) / 100
    counts[Math.min(bins - 1, Math.floor(fraction * bins))] += 1
  }
  return counts
}
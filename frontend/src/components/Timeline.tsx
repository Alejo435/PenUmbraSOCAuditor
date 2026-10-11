import { useEffect, useRef, useState } from 'react'
import { humanize, timeOf } from '@/lib/format'
import { assignRows, binEvents, percentAt } from '@/lib/timeline'
import { cn } from '@/lib/utils'
import { useConsoleStore } from '@/store'

const LABEL_WIDTH = 168
const LABEL_HEIGHT = 32
const LABEL_GAP = 8
// vertical space per row of labels, including the gap to the row above
const ROW_HEIGHT = 40
// number of slices in the activity strip
const BINS = 80
// fractions of the window that get a time label
const TICKS = [0, 0.25, 0.5, 0.75, 1]

// tracks an element's width so labels can be laid out in pixels and reflow when the window resizes
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

// every detection as a numbered label above the axis, connected to the moment it fired,
// with event volume beneath as a faint strip
function StoryTrack({ width }: { width: number }) {
  const events = useConsoleStore((s) => s.events)
  const alerts = useConsoleStore((s) => s.state?.snapshot.alerts) ?? []
  const nodes = useConsoleStore((s) => s.state?.snapshot.nodes) ?? []
  const clock = useConsoleStore((s) => s.state?.replay.clock)

  if (events.length === 0) {
    return <p className="py-3 text-sm text-penumbra-300">Detections appear here as the stream reveals them</p>
  }

  const start = Date.parse(events[0].timestamp)
  const day = events[0].timestamp.slice(0, 10)
  // the window ends at the scenario clock, so nothing past the current moment can be drawn
  const end = Math.max(Date.parse(`${day}T${clock}Z`) || 0, Date.parse(events[events.length - 1].timestamp))
  const xAt = (timestamp: string) => (percentAt(Date.parse(timestamp), start, end) / 100) * width

  const pins = alerts.map((alert) => xAt(alert.timestamp))
  // each label starts just left of its pin but never runs past either edge of the track
  const lefts = pins.map((x) => Math.min(Math.max(x - 12, 0), Math.max(width - LABEL_WIDTH, 0)))
  const rows = assignRows(lefts, LABEL_WIDTH + LABEL_GAP)
  const labelsHeight = Math.max(1, ...rows.map((row) => row + 1)) * ROW_HEIGHT
  // row 0 sits closest to the axis and later rows stack upward
  const topOf = (row: number) => labelsHeight - (row + 1) * ROW_HEIGHT

  const labelOf = new Map(nodes.map((node) => [node.id, node.label]))
  const counts = binEvents(events, start, end, BINS)
  const peak = Math.max(1, ...counts)
  const newest = alerts.length - 1

  return (
    <div className="pt-3">
      <div className="relative" style={{ height: labelsHeight }}>
        {alerts.length === 0 && <p className="absolute bottom-2 text-sm text-penumbra-300">No detections yet</p>}

        {/* connectors are drawn first so labels in lower rows sit on top of them */}
        {alerts.map((_, i) => (
          <span
            key={`line-${i}`}
            className={cn('absolute bottom-0 w-px', i === newest ? 'bg-ember-500' : 'bg-corona-500/40')}
            style={{ left: pins[i], top: topOf(rows[i]) + LABEL_HEIGHT }}
          />
        ))}

        {alerts.map((alert, i) => {
          const entity = alert.entities[0]
          return (
            <div
              key={`label-${i}`}
              title={alert.message}
              className={cn(
                'absolute flex flex-col justify-center rounded-sm border-l-2 bg-umbra-700 px-2 text-xs leading-4',
                i === newest ? 'border-ember-500' : 'border-corona-500',
              )}
              style={{ left: lefts[i], top: topOf(rows[i]), width: LABEL_WIDTH, height: LABEL_HEIGHT }}
            >
              <span className="flex gap-1.5 truncate">
                <span className={cn('tabular-nums', i === newest ? 'text-ember-300' : 'text-corona-400')}>
                  #{i + 1}
                </span>
                <span className="truncate text-light-50">{humanize(alert.rule)}</span>
              </span>
              <span className="truncate text-penumbra-300">{labelOf.get(entity) ?? entity}</span>
            </div>
          )
        })}
      </div>

      {/* the axis, with a pin where each detection fired */}
      <div className="relative h-px bg-umbra-500">
        {alerts.map((_, i) => (
          <span
            key={i}
            className={cn(
              'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full',
              i === newest
                ? 'bg-ember-500 shadow-[0_0_10px_var(--ember-glow)]'
                : 'bg-corona-500 shadow-[0_0_8px_var(--corona-glow)]',
            )}
            style={{ left: pins[i] }}
          />
        ))}
      </div>

      {/* event volume over time, so routine activity reads as a faint texture beneath the detections */}
      <div className="mt-2 flex h-6 items-end gap-px" aria-hidden="true">
        {counts.map((count, i) => (
          <span key={i} className="flex-1 bg-penumbra-400/40" style={{ height: `${(count / peak) * 100}%` }} />
        ))}
      </div>

      <div className="relative mt-1 h-4">
        {TICKS.map((fraction) => (
          <span
            key={fraction}
            className={cn(
              'absolute text-xs tabular-nums text-penumbra-300',
              fraction === 0 ? '' : fraction === 1 ? '-translate-x-full' : '-translate-x-1/2',
            )}
            style={{ left: `${fraction * 100}%` }}
          >
            {timeOf(new Date(start + fraction * (end - start)).toISOString())}
          </span>
        ))}
      </div>
    </div>
  )
}

// single story track: detections in order along scenario time, above a strip of overall activity
export function Timeline() {
  const [ref, width] = useWidth<HTMLDivElement>()

  return (
    <div ref={ref} className="px-4 pb-2">
      {width > 0 && <StoryTrack width={width} />}
    </div>
  )
}
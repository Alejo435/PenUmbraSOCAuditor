import { create } from 'zustand'
import type { LogEvent, StateResponse } from '@/types'

// how far back the event rate looks, long enough to smooth out gaps between events
const RATE_WINDOW_MS = 5000

type RateSample = { at: number; processed: number }

// adds the newest sample, drops stale ones and computes the rate across the remaining window
function measureRate(samples: RateSample[], processed: number) {
  const now = performance.now()
  // a lower processed count means the replay was reset, so earlier samples no longer apply
  const kept = samples.filter((s) => now - s.at <= RATE_WINDOW_MS && s.processed <= processed)
  kept.push({ at: now, processed })

  const oldest = kept[0]
  const seconds = (now - oldest.at) / 1000
  const eventsPerSecond = seconds > 0 ? (processed - oldest.processed) / seconds : 0
  return { rateSamples: kept, eventsPerSecond }
}

type ConsoleStore = {
  // latest response from GET /api/state, null until the first poll succeeds
  state: StateResponse | null
  // events replayed so far, oldest first
  events: LogEvent[]
  // message from the most recent failed poll, cleared on the next success
  connectionError: string | null
  // events per second over the recent window, in wall-clock time
  eventsPerSecond: number
  rateSamples: RateSample[]

  // id of the graph node the analyst clicked, null when nothing is selected
  selectedNodeId: string | null
  selectNode: (id: string | null) => void

  applyPoll: (state: StateResponse, events: LogEvent[]) => void
  setConnectionError: (message: string) => void
}

// shared backend data for the whole console, written only by the polling hook
// shared backend data for the whole console, written only by the polling hook
export const useConsoleStore = create<ConsoleStore>()((set) => ({
  state: null,
  events: [],
  connectionError: null,
  eventsPerSecond: 0,
  rateSamples: [],
  selectedNodeId: null,
  selectNode: (id) => set({ selectedNodeId: id }),
  applyPoll: (state, events) =>
    set((current) => ({
      state,
      events,
      connectionError: null,
      ...measureRate(current.rateSamples, state.replay.processed),
      // a reset removes every node, so a selection pointing at a missing node is cleared
      selectedNodeId: state.snapshot.nodes.some((n) => n.id === current.selectedNodeId)
        ? current.selectedNodeId
        : null,
    })),
  setConnectionError: (message) => set({ connectionError: message }),
}))
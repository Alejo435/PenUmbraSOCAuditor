import { useEffect } from 'react'
import { api } from '@/lib/api'
import { useConsoleStore } from '@/store'

const POLL_MS = 500

// polls the backend and writes the results into the store. mount it once in the shell;
// every other component reads from the store instead of fetching on its own
export function useBackendPolling() {
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function poll() {
      try {
        const [state, events] = await Promise.all([api.getState(), api.getEvents()])
        if (!cancelled) useConsoleStore.getState().applyPoll(state, events)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          useConsoleStore.getState().setConnectionError(message)
        }
      }
      // the next poll is scheduled only after this one finishes, so slow responses never overlap
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS)
    }

    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])
}
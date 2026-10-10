import { useEffect, useState } from 'react'

// starting point for the fake scenario clock
const DEMO_START = Date.parse('2026-10-09T02:14:00Z')

// temporary stand-in for the event stream so the header moves before the backend exists
export function useDemoTicker() {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const eventsPerSecond = 10 + 3 * Math.sin(elapsed / 4)

  return {
    scenarioTime: new Date(DEMO_START + elapsed * 1000),
    eventsPerSecond,
  }
}
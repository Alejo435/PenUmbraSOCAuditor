import { useEffect, useRef } from 'react'
import { useConsoleStore } from '@/store'

// served from frontend/public, so the path starts at the site root
const SOUND_URL = '/sounds/high-alert.mp3'
const VOLUME = 0.6

// plays a sound when a new high severity alert arrives. alerts that existed when the console
// loaded stay silent, so refreshing mid-replay does not replay every sound
export function useAlertSound() {
  const alerts = useConsoleStore((s) => s.state?.snapshot.alerts)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const seenRef = useRef<number | null>(null)

  useEffect(() => {
    if (!alerts) return

    // the first snapshot sets the baseline, and a shorter list means the replay was reset
    if (seenRef.current === null || alerts.length < seenRef.current) {
      seenRef.current = alerts.length
      return
    }

    const fresh = alerts.slice(seenRef.current)
    seenRef.current = alerts.length
    if (!fresh.some((alert) => alert.severity === 'high')) return

    audioRef.current ??= new Audio(SOUND_URL)
    const audio = audioRef.current
    audio.volume = VOLUME
    // restart from the beginning in case the previous sound is still playing
    audio.currentTime = 0
    // browsers refuse audio until the page has been clicked, so a refused play is ignored
    audio.play().catch(() => {})
  }, [alerts])
}
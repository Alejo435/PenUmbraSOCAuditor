import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useConsoleStore } from '@/store'
import type { NodeReport } from '@/types'

// one collapsible block of formatted json
function JsonSection({ label, data }: { label: string; data: unknown }) {
  return (
    <details className="border-t first:border-t-0">
      <summary className="cursor-pointer select-none py-2 text-sm text-penumbra-200 hover:text-light-100">
        {label}
      </summary>
      <pre className="mb-3 max-h-[50vh] overflow-auto rounded-sm bg-umbra-900 p-3 font-mono text-xs text-penumbra-200">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  )
}

// mounted only while the dialog is open, so a closed dialog costs nothing on each poll
function RawDataContents() {
  const state = useConsoleStore((s) => s.state)
  const events = useConsoleStore((s) => s.events)
  const [reports, setReports] = useState<NodeReport[] | null>(null)

  // reports live behind their own endpoint, so they are refetched on every poll.
  // a failed fetch keeps showing the last list
  useEffect(() => {
    let cancelled = false
    api.getReports().then(
      (next) => {
        if (!cancelled) setReports(next)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [state])

  return (
    <div>
      <JsonSection label={`Replayed events (${events.length})`} data={events} />
      <JsonSection label="Current state from /api/state" data={state} />
      <JsonSection label={`Node reports (${reports?.length ?? 0})`} data={reports ?? []} />
    </div>
  )
}

// header button that opens everything the console currently holds as raw json
export function RawDataDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          dialogRef.current?.showModal()
        }}
        className="rounded-sm px-2 py-1 text-sm text-penumbra-300 hover:bg-umbra-700 hover:text-light-100"
      >
        Raw data
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-label="Raw data"
        className="m-auto max-h-[85vh] w-[min(56rem,90vw)] overflow-auto panel-surface rounded-xl border border-edge p-0 text-light-100 backdrop:bg-umbra-900/70"
      >
        <div className="sticky top-0 flex items-center justify-between border-b bg-umbra-800 px-4 py-3">
          <h2 className="text-sm font-medium">Raw data</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-sm px-2 py-1 text-sm text-penumbra-300 hover:bg-umbra-700 hover:text-light-100"
          >
            Close
          </button>
        </div>
        <div className="px-4 pb-2">{open && <RawDataContents />}</div>
      </dialog>
    </>
  )
}
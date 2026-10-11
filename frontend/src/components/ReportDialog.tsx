import { useEffect, useRef, useState } from 'react'
import { api } from "@/lib/api";
import { ReportMarkdown } from "@/components/ReportMarkdown";
import { cn } from "@/lib/utils";
import { useConsoleStore } from "@/store";
import type { FullReport, OverallSeverity } from "@/types";

const SEVERITY_TEXT: Record<OverallSeverity, string> = {
	low: "text-sev-low",
	medium: "text-sev-medium",
	high: "text-sev-high",
	critical: "text-sev-critical",
};

function messageOf(reason: unknown) {
	return reason instanceof Error ? reason.message : String(reason);
}

const ACTION =
  'rounded-sm px-2 py-1 text-sm text-penumbra-300 hover:bg-umbra-700 hover:text-light-100 disabled:pointer-events-none disabled:opacity-40'

// saves the markdown through a temporary link, since the report already exists in the browser
function download(report: FullReport) {
  const url = URL.createObjectURL(new Blob([report.report], { type: 'text/markdown' }))
  const link = document.createElement('a')
  link.href = url
  link.download = report.file
  link.click()
  // released after a moment so the browser has started the download first
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// current time, refreshed once a second while active, for showing how long gemma has been working
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

// placeholder lines shaped roughly like the report while the first version loads
function ReportSkeleton() {
  const lines = ['h-5 w-1/3', 'w-2/3', 'w-1/2', 'mt-6 h-4 w-1/4', 'w-full', 'w-5/6', 'w-3/4']
  return (
    <div className="space-y-3" aria-hidden="true">
      {lines.map((size, i) => (
        <div key={i} className={cn('h-3 rounded-sm bg-umbra-700 motion-safe:animate-pulse', size)} />
      ))}
    </div>
  )
}

// incident report popup. a quick rules-based version appears at once while the gemma version
// is written in the background, then replaces it when ready
export function ReportDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // increases on every new request so answers to an earlier one are ignored
  const runRef = useRef(0)
  const hasNodes = useConsoleStore((s) => (s.state?.snapshot.nodes.length ?? 0) > 0)
  const aiEnabled = useConsoleStore((s) => s.state?.reports.mode === 'gemma')
  const [report, setReport] = useState<FullReport | null>(null)
  const [aiPending, setAiPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const now = useNow(aiPending)
  const waited = Math.max(0, Math.floor((now - startedAt) / 1000))

  // requests a quick version at once and, when ai is on, the gemma version in the background
  function generate() {
    const run = ++runRef.current
    setReport(null)
    setError(null)
    setAiPending(aiEnabled)
    setStartedAt(Date.now())

    // the quick version only fills in while nothing better has arrived
    api.getFullReport(false).then(
      (quick) => {
        if (run === runRef.current) setReport((current) => current ?? quick)
      },
      (reason: unknown) => {
        if (run === runRef.current) setError(messageOf(reason))
      },
    )

    if (!aiEnabled) return
    api
      .getFullReport(true)
      .then(
        (full) => {
          if (run !== runRef.current) return
          setReport(full)
          setError(null)
        },
        (reason: unknown) => {
          if (run === runRef.current) setError(messageOf(reason))
        },
      )
      .finally(() => {
        if (run === runRef.current) setAiPending(false)
      })
  }

  // reopening shows the existing report, so gemma only rewrites the summary when asked to
  function open() {
    dialogRef.current?.showModal()
    if (!report && !aiPending) generate()
  }

  return (
    <>
      <button
        type="button"
        disabled={!hasNodes && !report && !aiPending}
        onClick={open}
        className="rounded-sm border px-3 py-1 text-sm text-light-100 hover:bg-umbra-700 disabled:opacity-40"
      >
        Report
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Incident report"
        className="m-auto h-[88vh] w-[min(64rem,94vw)] rounded-md border bg-umbra-800 p-0 text-light-100 backdrop:bg-umbra-900/70"
      >
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
            <div className="min-w-0 space-y-1">
              <h2 className="text-base font-medium">Incident report</h2>
              {report && (
                <p className="text-sm tabular-nums text-penumbra-300">
                  <span className={cn('font-medium capitalize', SEVERITY_TEXT[report.severity])}>
                    {report.severity}
                  </span>
                  {' · '}generated {report.generated_at} · {report.nodes} nodes · {report.alerts} alerts ·{' '}
                  {report.ai_reports} AI node reports
                </p>
              )}
              {aiPending && (
                <p className="flex items-center gap-2 text-xs tabular-nums text-haze-300" role="status">
                  <span className="size-1.5 shrink-0 rounded-full bg-haze-300 motion-safe:animate-pulse" />
                  Gemma is writing the executive summary, {waited}s so far.
                  {report && ' A quick version is shown meanwhile'}
                </p>
              )}
              {report?.source === 'rules' && report.error && (
                <p className="text-xs text-penumbra-300">AI summary unavailable, so a rules-based summary is shown</p>
              )}
              {report && error && <p className="text-xs text-sev-high">{error}</p>}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={generate} disabled={aiPending || !hasNodes} className={ACTION}>
                Regenerate
              </button>
              <button
                type="button"
                onClick={() => report && download(report)}
                disabled={!report}
                className={ACTION}
              >
                {aiPending && report ? 'Download quick version' : 'Download'}
              </button>
              <button type="button" onClick={() => dialogRef.current?.close()} className={ACTION}>
                Close
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
            {report ? (
              <article>
                <ReportMarkdown markdown={report.report} aiSummary={report.source === 'gemma'} />
              </article>
            ) : error ? (
              <div className="space-y-3">
                <p className="text-sm text-sev-high">{error}</p>
                <button
                  type="button"
                  onClick={generate}
                  disabled={aiPending}
                  className="rounded-sm border px-3 py-1.5 text-sm text-light-100 hover:bg-umbra-700 disabled:opacity-40"
                >
                  Try again
                </button>
              </div>
            ) : (
              <>
                <p className="sr-only" role="status">
                  Generating report
                </p>
                <ReportSkeleton />
              </>
            )}
          </div>
        </div>
      </dialog>
    </>
  )
}
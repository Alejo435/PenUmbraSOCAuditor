import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useConsoleStore } from '@/store'
import type { NodeReport } from '@/types'

export type ReportSection = { label: string | null; text: string }

export type ParsedReport = { sections: ReportSection[]; connections: string[] }

const SECTION_LABEL = /^(What it is|What happened|Why it matters|What to do):\s*(.*)$/i

// a report is a narrative, a blank line, then a facts block. only connections are kept from the
// facts, because the node summary already shows the rest
export function parseReport(text: string): ParsedReport {
  const split = text.indexOf('\n\n')
  const narrative = split === -1 ? text : text.slice(0, split)
  const facts = split === -1 ? '' : text.slice(split + 2)

  const sections: ReportSection[] = []
  for (const line of narrative.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = SECTION_LABEL.exec(trimmed)
    if (match) {
      // the model sometimes changes capitalization, so labels are normalized
      const label = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
      sections.push({ label, text: match[2] })
    } else if (sections.length > 0) {
      sections[sections.length - 1].text += ` ${trimmed}`
    } else {
      sections.push({ label: null, text: trimmed })
    }
  }

  // connection lines are the indented ones in the facts block
  const connections = facts
    .split('\n')
    .filter((line) => line.startsWith('  '))
    .map((line) => line.trim())

  return { sections, connections }
}

// fetches a node's report and refetches on every poll, since reports are rewritten in the
// background and their status changes while the node stays selected
export function useNodeReport(index: number) {
  const pollState = useConsoleStore((s) => s.state)
  const [report, setReport] = useState<NodeReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getReport(index).then(
      (next) => {
        if (cancelled) return
        setReport(next)
        setError(null)
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => {
      cancelled = true
    }
  }, [index, pollState])

  return { report, error }
}
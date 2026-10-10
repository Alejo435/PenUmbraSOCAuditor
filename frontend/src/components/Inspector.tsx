import { humanize, timeOf } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useConsoleStore } from '@/store'
import type { EntityType, GraphNode } from '@/types'

const TYPE_LABEL: Record<EntityType, string> = {
  user: 'User account',
  host: 'Host or service',
  ip: 'IP address',
  process: 'Process',
  file: 'File or web path',
}

// risk as a bar so the score reads at a glance, with the number beside it for precision
function RiskMeter({ risk, flagged }: { risk: number; flagged: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-umbra-600"
        role="meter"
        aria-label="Risk score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={risk}
      >
        <div
          className={cn('h-full rounded-full', flagged ? 'bg-corona-500' : 'bg-penumbra-400')}
          style={{ width: `${risk}%` }}
        />
      </div>
      <span className="text-sm tabular-nums text-light-100">
        {risk}
        <span className="text-penumbra-300">/100</span>
      </span>
    </div>
  )
}

// facts about the selected node taken directly from the graph, so everything here is observed data
function NodeSummary({ node }: { node: GraphNode }) {
  const flagged = node.flags.length > 0

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="text-xs text-penumbra-300">{TYPE_LABEL[node.type]}</p>
        <h3 className={cn('break-all text-lg font-medium', flagged ? 'text-light-50' : 'text-light-100')}>
          {node.label}
        </h3>
      </div>

      <RiskMeter risk={node.risk} flagged={flagged} />

      {flagged && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Detections">
          {node.flags.map((flag) => (
            <li
              key={flag}
              className="rounded-sm border border-corona-500/40 bg-corona-500/10 px-1.5 py-0.5 text-xs text-corona-400"
            >
              {humanize(flag)}
            </li>
          ))}
        </ul>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm [&>dt]:text-penumbra-300">
        <dt>Seen</dt>
        <dd className="tabular-nums">
          {node.count} {node.count === 1 ? 'time' : 'times'}
        </dd>
        <dt>First</dt>
        <dd className="tabular-nums">{timeOf(node.first_seen)}</dd>
        <dt>Last</dt>
        <dd className="tabular-nums">{timeOf(node.last_seen)}</dd>
        {node.detail && (
          <>
            <dt>Detail</dt>
            <dd className="break-all font-mono text-xs">{node.detail}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

// right panel: details for whichever node is selected in the graph
export function Inspector() {
  const node = useConsoleStore((s) => s.state?.snapshot.nodes.find((n) => n.id === s.selectedNodeId))

  if (!node) {
    return <p className="p-3 text-sm text-penumbra-300">Select a node in the graph to inspect it</p>
  }
  return <NodeSummary node={node} />
}
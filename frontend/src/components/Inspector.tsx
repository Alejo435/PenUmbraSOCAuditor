import { humanize, timeOf } from "@/lib/format";
import { parseReport, useNodeReport } from "@/lib/report";
import { cn } from "@/lib/utils";
import { useConsoleStore } from "@/store";
import type { EntityType, GraphNode, NodeReport, ReportStatus } from "@/types";

const TYPE_LABEL: Record<EntityType, string> = {
	user: "User account",
	host: "Host or service",
	ip: "IP address",
	process: "Process",
	file: "File or web path",
};

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
					className={cn(
						"h-full rounded-full",
						flagged ? "bg-corona-500" : "bg-penumbra-400",
					)}
					style={{ width: `${risk}%` }}
				/>
			</div>
			<span className="text-sm tabular-nums text-light-100">
				{risk}
				<span className="text-penumbra-300">/100</span>
			</span>
		</div>
	);
}

// facts about the selected node taken directly from the graph, so everything here is observed data
function NodeSummary({ node }: { node: GraphNode }) {
	const flagged = node.flags.length > 0;

	return (
		<div className="space-y-4 p-3">
			<div>
				<p className="text-xs text-penumbra-300">{TYPE_LABEL[node.type]}</p>
				<h3
					className={cn(
						"break-all text-lg font-medium",
						flagged ? "text-light-50" : "text-light-100",
					)}
				>
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
					{node.count} {node.count === 1 ? "time" : "times"}
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
	);
}

// same wording as the backend's test dashboard, so both tools describe reports the same way
const STATUS_TEXT: Record<ReportStatus, string> = {
	queued: "Waiting for Gemma",
	generating: "Gemma is writing",
	updating: "Updating",
	ready: "Up to date",
	error: "Gemma unavailable",
};

// whether the report on screen is final or still being written, plus its version and update time
function ReportFreshness({ report }: { report: NodeReport }) {
	const busy =
		report.status === "queued" ||
		report.status === "generating" ||
		report.status === "updating";
	const failed = report.status === "error";

	return (
		<div className="flex items-center gap-2 text-xs" role="status">
			<span
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					failed
						? "bg-sev-high"
						: busy
							? "bg-haze-300 motion-safe:animate-pulse"
							: "bg-penumbra-400",
				)}
			/>
			<span className={failed ? "text-sev-high" : "text-penumbra-200"}>
				{STATUS_TEXT[report.status]}
			</span>
			<span className="ml-auto tabular-nums text-penumbra-300">
				v{report.version} · updated {report.updated_at}
			</span>
		</div>
	);
}

// the narrative is interpretation, so ai-written text is drawn in haze with a dashed rail,
// while the connections list is observed data and stays in full light
function ReportView({ index }: { index: number }) {
	const { report, error } = useNodeReport(index);

	if (!report) {
		return (
			<p className="border-t p-3 text-sm text-penumbra-300">
				{error ?? "Loading report"}
			</p>
		);
	}

	const { sections, connections } = parseReport(report.report);
	const fromAi = report.source === "gemma";

	return (
		<>
			<div className="space-y-4 border-t p-3">
				<ReportFreshness report={report} />

				<section aria-label="Analysis">
					<h4
						className={cn(
							"mb-2 text-xs font-medium",
							fromAi ? "text-haze-300" : "text-penumbra-200",
						)}
					>
						{fromAi ? "AI analysis" : "Rule-based summary"}
					</h4>
					<div
						className={cn(
							"space-y-2 border-l-2 pl-3",
							fromAi
								? "border-dashed border-haze-300/60"
								: "border-penumbra-400/60",
						)}
					>
						{sections.map((section, i) => (
							<p
								key={i}
								className={cn(
									"text-sm",
									fromAi ? "text-haze-300" : "text-light-100",
								)}
							>
								{section.label && (
									<span className="block text-xs text-penumbra-300">
										{section.label}
									</span>
								)}
								{section.text}
							</p>
						))}
					</div>
				</section>

				{connections.length > 0 && (
					<section aria-label="Connections">
						<h4 className="mb-2 text-xs font-medium text-penumbra-200">
							Connections
						</h4>
						<ul className="space-y-1 font-mono text-xs text-light-100">
							{connections.map((line, i) => (
								<li
									key={i}
									className={cn(
										"break-all",
										line.includes("[suspicious") && "text-corona-400",
									)}
								>
									{line}
								</li>
							))}
						</ul>
					</section>
				)}
			</div>

		</>
	);
}

// right panel: details for whichever node is selected in the graph
export function Inspector() {
	const node = useConsoleStore((s) =>
		s.state?.snapshot.nodes.find((n) => n.id === s.selectedNodeId),
	);

	if (!node) {
		return (
			<p className="p-3 text-sm text-penumbra-300">
				Select a node in the graph to inspect it
			</p>
		);
	}
	return (
		<>
			<NodeSummary node={node} />
			{/* keyed by node so switching nodes starts with a clean report instead of the previous one */}
			<ReportView key={node.id} index={node.index} />
		</>
	);
}

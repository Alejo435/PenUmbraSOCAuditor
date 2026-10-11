import { alertsByEvent } from "@/lib/evidence";
import { humanize, timeOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useConsoleStore } from "@/store";
import type { Alert, LogEvent } from "@/types";

const SEVERITY_TEXT: Record<Alert["severity"], string> = {
	medium: "text-sev-medium",
	high: "text-sev-high",
};

// one log line. rows that triggered a detection are lit in corona, everything else stays in shadow
function FeedRow({ event, alerts }: { event: LogEvent; alerts: Alert[] }) {
	const lit = alerts.length > 0;
	const top = alerts.find((a) => a.severity === "high") ?? alerts[0];
	const fields = Object.entries(event.fields)
		.map(([key, value]) => `${key}=${value}`)
		.join(" ");

	return (
		<li
			className={cn(
				"border-b border-l-2 border-l-transparent px-3 py-2",
				"motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1",
				lit && "border-l-corona-500 bg-corona-500/8",
			)}
		>
			<div className="flex items-baseline gap-2">
				<span className="text-xs tabular-nums text-penumbra-300">
					{timeOf(event.timestamp)}
				</span>
				<span
					className={cn(
						"truncate text-sm",
						lit ? "font-medium text-light-50" : "text-light-100",
					)}
				>
					{humanize(event.event)}
				</span>
				{top && (
					<span
						className={cn(
							"ml-auto text-xs font-medium capitalize",
							SEVERITY_TEXT[top.severity],
						)}
					>
						{top.severity}
					</span>
				)}
			</div>
			{/* raw fields stay in mono because they are log data, shown as evidence */}
			<p
				className="mt-0.5 truncate font-mono text-xs text-penumbra-300"
				title={event.message}
			>
				{event.source} {fields}
			</p>
			{lit && (
				<p className="mt-1 text-xs text-corona-400">
					Detection: {alerts.map((a) => humanize(a.rule)).join(", ")}
				</p>
			)}
		</li>
	);
}

// replayed events, newest first
export function EventFeed() {
	const events = useConsoleStore((s) => s.events);
	const alerts = useConsoleStore((s) => s.state?.snapshot.alerts) ?? [];
	const alertsAt = alertsByEvent(events, alerts);

	if (events.length === 0) {
		return (
			<p className="p-3 text-sm text-penumbra-300">
				Waiting for events from the stream
			</p>
		);
	}

	return (
		<ol>
			{events
				.map((event, index) => ({ event, index }))
				.reverse()
				.map(({ event, index }) => (
					// arrival order is the key because it never changes for an event, while line numbers
					// can repeat for events injected through the api
					<FeedRow
						key={index}
						event={event}
						alerts={alertsAt.get(index) ?? []}
					/>
				))}
		</ol>
	);
}

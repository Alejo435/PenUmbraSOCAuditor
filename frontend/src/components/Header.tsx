import { cn } from "@/lib/utils";
import { RawDataDialog } from "@/components/RawDataDialog";
import { ReportDialog } from '@/components/ReportDialog'
import { useConsoleStore } from "@/store";
import type { StateResponse, StreamStatus } from "@/types";

const STATUS_LABEL: Record<StreamStatus, string> = {
	idle: "Not connected",
	live: "Live",
	standby: "Standing by",
};

// stream state shown as a light source: pulsing when live, dim when paused, hollow when idle
function LiveIndicator({ status }: { status: StreamStatus }) {
	return (
		<div className="flex items-center gap-2" role="status" aria-live="polite">
			<span className="relative flex size-2.5">
				{status === "live" && (
					<span className="absolute inset-0 rounded-full bg-light-100 opacity-60 motion-safe:animate-ping" />
				)}
				<span
					className={cn(
						"relative size-2.5 rounded-full",
						status === "live" &&
							"bg-light-100 shadow-[0_0_8px_var(--light-100)]",
						status === "standby" && "bg-penumbra-400",
						status === "idle" && "border border-penumbra-400",
					)}
				/>
			</span>
			<span
				className={cn(
					"text-sm",
					status === "live" ? "text-light-100" : "text-penumbra-300",
				)}
			>
				{STATUS_LABEL[status]}
			</span>
		</div>
	);
}

// shows the replay's simulation clock rather than the wall clock
function ScenarioClock({
	day,
	time,
}: {
	day: string | null;
	time: string | null;
}) {
	return (
		<div className="flex items-baseline gap-2 tabular-nums">
			{day && <span className="text-sm text-penumbra-300">{day}</span>}
			<span className="text-lg font-medium text-light-100">
				{time ?? "--:--:--"}
			</span>
			<span className="text-sm text-penumbra-300">UTC</span>
		</div>
	);
}

// events received per second, so the console feels connected to a running system
function EventRate({ rate }: { rate: number }) {
	return (
		<div className="text-sm tabular-nums text-penumbra-300">
			<span className="text-light-100">{rate.toFixed(1)}</span> events/s
		</div>
	);
}

// background report writer state, so it is visible when ai analysis is still catching up
function AnalystStatus() {
	const summary = useConsoleStore((s) => s.state?.reports);
	if (!summary) return null;

	if (summary.mode === "rules") {
		return <div className="text-sm text-penumbra-300">AI analysis off</div>;
	}

	const writing = summary.pending > 0;
	const failing = summary.errors > 0;

	return (
		<div className="flex items-center gap-2 text-sm tabular-nums text-penumbra-300">
			<span
				className={cn(
					"size-1.5 rounded-full",
					failing
						? "bg-sev-high"
						: writing
							? "bg-haze-300 motion-safe:animate-pulse"
							: "bg-penumbra-400",
				)}
			/>
			<span>
				AI reports <span className="text-light-100">{summary.ai_reports}</span>/
				{summary.total}
			</span>
			{failing ? (
				<span className="text-sev-high">Gemma unavailable</span>
			) : writing ? (
				<span>{summary.pending} in progress</span>
			) : null}
		</div>
	);
}

// a finished replay still reads as live, since a real monitoring session stays connected
function streamStatus(
	state: StateResponse | null,
	connectionError: string | null,
): StreamStatus {
	if (!state || connectionError || state.replay.error) return "idle";
	if (state.replay.running || state.replay.finished) return "live";
	return "standby";
}

// top bar of the console: wordmark and stream status on the left, event rate and clock on the right
export function Header({ className }: { className?: string }) {
	const state = useConsoleStore((s) => s.state);
	const events = useConsoleStore((s) => s.events);
	const connectionError = useConsoleStore((s) => s.connectionError);
	const eventsPerSecond = useConsoleStore((s) => s.eventsPerSecond);

	const status = streamStatus(state, connectionError);
	// the backend clock has no date, so the date comes from the first replayed event
	const day = events.length > 0 ? events[0].timestamp.slice(0, 10) : null;
	const time = state && status !== "idle" ? state.replay.clock : null;

	return (
		<header
			className={cn(
				"flex items-center gap-6 border-b bg-umbra-800 px-4",
				className,
			)}
		>
			<span className="font-semibold tracking-tight text-light-50">
				PenUmbra
			</span>
			<LiveIndicator status={status} />
			<div className="ml-auto flex items-center gap-6">
				<AnalystStatus />
				<EventRate rate={eventsPerSecond} />
				<ScenarioClock day={day} time={time} />
        <ReportDialog />
				<RawDataDialog />
			</div>
		</header>
	);
}

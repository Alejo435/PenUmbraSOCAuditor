import { cn } from "@/lib/utils";
import type { StreamStatus } from "@/types";

const STATUS_LABEL: Record<StreamStatus, string> = {
	idle: "Not connected",
	live: "Live",
	paused: "Paused",
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
						status === "paused" && "bg-penumbra-400",
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

// splits a date into utc day and time so the clock matches log timestamps in any time zone
function toUtcParts(date: Date) {
  const iso = date.toISOString()
  return { day: iso.slice(0, 10), time: iso.slice(11, 19) }
}

// shows the timestamp of the latest replayed event rather than the wall clock
function ScenarioClock({ time }: { time: Date | null }) {
  const parts = time ? toUtcParts(time) : null

  return (
    <div className="flex items-baseline gap-2 tabular-nums">
      <span className="text-sm text-penumbra-300">{parts?.day}</span>
      <time dateTime={time?.toISOString()} className="text-lg font-medium text-light-100">
        {parts?.time ?? '--:--:--'}
      </time>
      <span className="text-sm text-penumbra-300">UTC</span>
    </div>
  )
}

// events received per second, so the console feels connected to a running system
function EventRate({ rate }: { rate: number }) {
  return (
    <div className="text-sm tabular-nums text-penumbra-300">
      <span className="text-light-100">{rate.toFixed(1)}</span> events/s
    </div>
  )
}

type HeaderProps = {
  status: StreamStatus
  // timestamp of the latest event, or null before any event has arrived
  scenarioTime: Date | null
  eventsPerSecond: number
  className?: string
}

// top bar of the console: wordmark and stream status on the left, event rate and clock on the right
export function Header({ status, scenarioTime, eventsPerSecond, className }: HeaderProps) {
  return (
    <header className={cn('flex items-center gap-6 border-b bg-umbra-800 px-4', className)}>
      <span className="font-semibold tracking-tight text-light-50">PenUmbra</span>
      <LiveIndicator status={status} />
      <div className="ml-auto flex items-center gap-6">
        <EventRate rate={eventsPerSecond} />
        <ScenarioClock time={scenarioTime} />
      </div>
    </header>
  )
}
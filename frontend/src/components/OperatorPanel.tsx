import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useConsoleStore } from "@/store";

// key that shows and hides the panel. backtick is used because browsers do not reserve it
const TOGGLE_KEY = "`";

// true when focus is in a text field, so typing a backtick there never toggles the panel
function isTyping(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
	);
}

// ready-made lines that each trigger a different detection rule with entities not in the replay,
// so every send creates a visible new alert. the timestamp is added when sending
const PRESETS = [
	{
		label: "Blocked RDP probe",
		line: "WARN firewall event=connection_blocked source_ip=198.51.100.77 destination_ip=192.0.2.50 destination_port=3389 protocol=TCP rule=deny_external_rdp",
	},
	{
		label: "Office app spawns shell",
		line: 'WARN endpoint event=unusual_process host=workstation-07 user=jordan process=cmd.exe pid=6120 parent=excel.exe command="cmd.exe /c whoami" detection=parent_process_anomaly',
	},
	{
		label: "Denied admin request",
		line: "WARN auth-service event=privilege_change user=jordan target_role=admin result=denied reason=not_in_approved_group",
	},
];

// a line that already starts with a date is sent as written
const HAS_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

// sends a hand-written log line into the backend so the console can be shown reacting live
function InjectEvent() {
	const clock = useConsoleStore((s) => s.state?.replay.clock);
	const day = useConsoleStore(
		(s) => s.events[0]?.timestamp.slice(0, 10) ?? null,
	);
	const [line, setLine] = useState(PRESETS[0].line);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function send() {
		const trimmed = line.trim();
		if (!trimmed) return;
		// the scenario date comes from the first replayed event, falling back to today before any arrive
		const timestamp = `${day ?? new Date().toISOString().slice(0, 10)}T${clock ?? "00:00:00"}Z`;
		const raw = HAS_TIMESTAMP.test(trimmed)
			? trimmed
			: `${timestamp} ${trimmed}`;

		setBusy(true);
		try {
			setMessage((await api.injectLog(raw)).message);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section aria-label="Inject event" className="mt-4 space-y-2 border-t pt-4">
			<h3 className="text-sm text-light-100">Inject event</h3>

			<div className="flex flex-wrap gap-1.5">
				{PRESETS.map((preset) => (
					<button
						key={preset.label}
						type="button"
						onClick={() => setLine(preset.line)}
						className="rounded-sm border px-2 py-1 text-xs text-penumbra-200 hover:bg-umbra-700 hover:text-light-100"
					>
						{preset.label}
					</button>
				))}
			</div>

			<textarea
				value={line}
				onChange={(event) => setLine(event.target.value)}
				onKeyDown={(event) => {
					// ctrl or cmd plus enter sends, so the presenter never has to reach for the mouse
					if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
						event.preventDefault();
						void send();
					}
				}}
				rows={4}
				spellCheck={false}
				aria-label="Log line"
				className="w-full resize-none rounded-sm border bg-umbra-900 p-2 font-mono text-xs text-light-100"
			/>
			<p className="text-xs text-penumbra-300">
				The timestamp is added at the current scenario time. Ctrl+Enter sends
			</p>

			<div className="flex items-center gap-3">
				<button
					type="button"
					disabled={busy || !line.trim()}
					onClick={() => void send()}
					className="rounded-sm bg-light-100 px-3 py-1.5 text-sm font-medium text-umbra-900 hover:bg-light-50 disabled:opacity-40"
				>
					Send
				</button>
				{message && (
					<p className="text-xs text-penumbra-300" role="status">
						{message}
					</p>
				)}
			</div>
		</section>
	);
}

// replay start, reset and progress. progress lives here rather than in the header so the main
// console never reveals that events come from a finite file
function ReplayControls() {
	const replay = useConsoleStore((s) => s.state?.replay);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// runs a backend action and shows its message, including errors such as starting a finished replay
	async function run(action: () => Promise<{ message: string }>) {
		setBusy(true);
		try {
			setMessage((await action()).message);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	}

	if (!replay) {
		return <p className="text-sm text-penumbra-300">Backend not connected</p>;
	}

	const percent =
		replay.total > 0 ? Math.round((replay.processed / replay.total) * 100) : 0;
	const label = replay.error
		? "Error"
		: replay.running
			? "Running"
			: replay.finished
				? "Finished"
				: "Ready";

	return (
		<section aria-label="Replay" className="space-y-3">
			<div className="flex items-baseline justify-between text-sm">
				<span className="text-light-100">{label}</span>
				<span className="tabular-nums text-penumbra-300">
					{replay.processed} / {replay.total} events
				</span>
			</div>

			<div
				className="h-1.5 overflow-hidden rounded-full bg-umbra-600"
				role="progressbar"
				aria-label="Replay progress"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
			>
				<div
					className="h-full rounded-full bg-light-100 transition-[width]"
					style={{ width: `${percent}%` }}
				/>
			</div>

			{replay.file && (
				<p
					className="truncate font-mono text-xs text-penumbra-300"
					title={replay.file}
				>
					{replay.file}
				</p>
			)}
			{replay.error && <p className="text-xs text-sev-high">{replay.error}</p>}

			<div className="flex gap-2">
				<button
					type="button"
					disabled={busy || replay.running || replay.finished}
					onClick={() => void run(api.start)}
					className="rounded-sm bg-light-100 px-3 py-1.5 text-sm font-medium text-umbra-900 hover:bg-light-50 disabled:opacity-40"
				>
					Start
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() => void run(api.reset)}
					className="rounded-sm border px-3 py-1.5 text-sm text-light-100 hover:bg-umbra-700 disabled:opacity-40"
				>
					Reset
				</button>
			</div>

			{message && (
				<p className="text-xs text-penumbra-300" role="status">
					{message}
				</p>
			)}
			<p className="text-xs text-penumbra-300">
				Speed is set with REPLAY_SPEED when the backend starts
			</p>
		</section>
	);
}

// hidden presenter controls, toggled with the backtick key and closed with escape
export function OperatorPanel() {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setOpen(false);
			} else if (event.key === TOGGLE_KEY && !isTyping(event.target)) {
				event.preventDefault();
				setOpen((value) => !value);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	if (!open) return null;

	return (
		<aside
			role="dialog"
			aria-label="Operator panel"
			className="fixed right-4 bottom-4 z-50 w-96 rounded-md border bg-umbra-800/95 p-4 shadow-2xl backdrop-blur"
		>
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-sm font-medium text-light-100">Operator</h2>
				<button
					type="button"
					onClick={() => setOpen(false)}
					className="rounded-sm px-2 py-1 text-sm text-penumbra-300 hover:bg-umbra-700 hover:text-light-100"
				>
					Close
				</button>
			</div>
			<ReplayControls />
		</aside>
	);
}

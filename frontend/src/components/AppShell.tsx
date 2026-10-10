import { Panel } from "@/components/Panel";
import { Header } from "@/components/Header";
import { useDemoTicker } from "@/lib/demoTicker";

// top-level console layout: header, event feed, graph stage, inspector and timeline
export function AppShell() {
	const demo = useDemoTicker();
	return (
		<div className="grid h-full grid-cols-[20rem_minmax(0,1fr)_22rem] grid-rows-[3rem_minmax(0,1fr)_14rem]">
			{/* temporary demo values until the stream store exists */}
			<Header
				status="live"
				scenarioTime={demo.scenarioTime}
				eventsPerSecond={demo.eventsPerSecond}
				className="col-span-3"
			/>
			<Panel title="Event feed" className="border-r" />

			{/* the graph stage is the darkest surface so lit evidence stands out against it */}
			<section
				className="min-h-0 min-w-0 bg-umbra-900"
				aria-label="Threat graph"
			/>

			<Panel title="Inspector" className="border-l" />

			<Panel title="Timeline" className="col-span-3 border-t" />
		</div>
	);
}

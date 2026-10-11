import { Panel } from "@/components/Panel";
import { Header } from "@/components/Header";
import { EventFeed } from "@/components/EventFeed";
import { ThreatGraph } from "@/components/ThreatGraph";
import { Inspector } from "@/components/Inspector";
import { Timeline } from "@/components/Timeline";
import { OperatorPanel } from "@/components/OperatorPanel";
import { useBackendPolling } from "@/lib/usePolling";

// top-level console layout: header, event feed, graph stage, inspector and timeline
export function AppShell() {
	useBackendPolling();
	return (
		<div className="grid h-full grid-cols-[20rem_minmax(0,1fr)_22rem] grid-rows-[3rem_minmax(0,1fr)_14rem]">
			<Header className="col-span-3" />
			<Panel title="Event feed" className="border-r">
				<EventFeed />
			</Panel>

			{/* the graph stage is the darkest surface so lit evidence stands out against it */}
			<section
				className="min-h-0 min-w-0 bg-umbra-900"
				aria-label="Threat graph"
			>
				<ThreatGraph />
			</section>

			<Panel title="Inspector" className="border-l">
				<Inspector />
			</Panel>

			<Panel title="Timeline" className="col-span-3 border-t">
				<Timeline />
			</Panel>

			{/* fixed position, so it floats above the grid instead of taking a cell */}
			<OperatorPanel />
		</div>
	);
}

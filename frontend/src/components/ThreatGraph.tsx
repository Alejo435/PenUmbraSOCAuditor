import cytoscape, { type Core } from "cytoscape";
import { useEffect, useRef } from "react";
import { buildGraphStyle } from "@/lib/graphStyle";
import { useConsoleStore } from "@/store";
import type { GraphElement, GraphSnapshot } from "@/types";

// space kept clear around the graph when it is fitted to the stage
const FIT_PADDING = 56;

// applies the latest snapshot: adds new elements at their backend positions, updates existing
// ones in place and removes anything the backend no longer has, which happens after a reset
function syncGraph(
	cy: Core,
	snapshot: GraphSnapshot,
	elements: GraphElement[],
) {
	const positions = new Map(elements.map((el) => [el.data.id, el.position]));
	const keep = new Set<string>();
	let added = false;

	// the last entry of the attack path is the most recent suspicious edge
	const emberId = snapshot.attack_path.at(-1);
	cy.batch(() => {
		for (const node of snapshot.nodes) {
			keep.add(node.id);
			const data = {
				id: node.id,
				label: node.label,
				type: node.type,
				risk: node.risk,
			};
			const classes = node.flags.length > 0 ? "flagged" : "";
			const existing = cy.getElementById(node.id);
			if (existing.empty()) {
				cy.add({
					group: "nodes",
					data,
					classes,
					position: positions.get(node.id) ?? { x: 0, y: 0 },
				});
				added = true;
			} else {
				existing.data(data);
				existing.classes(classes);
			}
		}

		for (const edge of snapshot.edges) {
			keep.add(edge.id);
			const label = edge.order
				? `#${edge.order} ${edge.relation}`
				: edge.relation;
			const classes =
				edge.id === emberId
					? "suspicious ember"
					: edge.suspicious
						? "suspicious"
						: "";
			const existing = cy.getElementById(edge.id);
			if (existing.empty()) {
				cy.add({
					group: "edges",
					data: {
						id: edge.id,
						source: edge.source,
						target: edge.target,
						label,
					},
					classes,
				});
				added = true;
			} else {
				// source and target never change, and cytoscape rejects edits to them
				existing.data("label", label);
				existing.classes(classes);
			}
		}

		cy.elements()
			.filter((el) => !keep.has(el.id()))
			.remove();
	});

	// refit only when something new arrived, so the view settles instead of drifting every poll
	if (added) {
		cy.stop(true);
		cy.animate({
			fit: { eles: cy.elements(), padding: FIT_PADDING },
			duration: 400,
			easing: "ease-out",
		});
	}
}

// the threat graph on the center stage, kept in sync with the backend snapshot
export function ThreatGraph() {
	const containerRef = useRef<HTMLDivElement>(null);
	const cyRef = useRef<Core | null>(null);
	const snapshot = useConsoleStore((s) => s.state?.snapshot);
	const elements = useConsoleStore((s) => s.state?.elements);
	const selectedNodeId = useConsoleStore((s) => s.selectedNodeId);

	// the cytoscape instance is created once and destroyed on unmount; data arrives through the effect below
	useEffect(() => {
		const cy = cytoscape({
			container: containerRef.current,
			style: buildGraphStyle(),
			layout: { name: "preset" },
			minZoom: 0.3,
			maxZoom: 2.5,
			autoungrabify: true,
			boxSelectionEnabled: false,
			// selection is handled by the store, so cytoscape's built-in selection is turned off
			autounselectify: true,
		});
		cyRef.current = cy;
		// tapping a node selects it and tapping empty stage clears the selection
		cy.on("tap", "node", (event) =>
			useConsoleStore.getState().selectNode(event.target.id()),
		);
		cy.on("tap", (event) => {
			if (event.target === cy) useConsoleStore.getState().selectNode(null);
		});
		return () => {
			cy.destroy();
			cyRef.current = null;
		};
	}, []);

	useEffect(() => {
		const cy = cyRef.current;
		if (!cy || !snapshot || !elements) return;
		syncGraph(cy, snapshot, elements);
	}, [snapshot, elements]);

	// lights the selected node and its direct connections and fades everything else. it reruns on
	// every snapshot because syncing reapplies classes, and new elements must be faded too
	useEffect(() => {
		const cy = cyRef.current;
		if (!cy) return;
		cy.batch(() => {
			cy.elements().removeClass("focus faded");
			if (!selectedNodeId) return;
			const node = cy.getElementById(selectedNodeId);
			if (node.empty()) return;
			node.addClass("focus");
			cy.elements().not(node.closedNeighborhood()).addClass("faded");
		});
	}, [selectedNodeId, snapshot]);

	// moves the ember dashes along the edge so the newest step of the attack visibly flows.
	// skipped entirely when the viewer prefers reduced motion
	useEffect(() => {
		const cy = cyRef.current;
		if (!cy || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
			return;

		let frame = 0;
		let offset = 0;
		const tick = () => {
			offset = (offset + 0.5) % 16;
			cy.edges(".ember").style("line-dash-offset", -offset);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, []);

	return <div ref={containerRef} className="h-full w-full" />;
}

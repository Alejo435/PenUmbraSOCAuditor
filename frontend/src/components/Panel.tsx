import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PanelProps = {
	title: string;
	// optional controls rendered on the right side of the panel header
	actions?: ReactNode;
	className?: string;
	children?: ReactNode;
};

// a titled region of the console, separated from its neighbors by hairline borders
export function Panel({ title, actions, className, children }: PanelProps) {
	return (
		<section
			className={cn("flex min-h-0 min-w-0 flex-col bg-umbra-800", className)}
		>
			<header className="flex h-9 shrink-0 items-center justify-between border-b px-3">
				<h2 className="text-sm font-medium text-penumbra-200">{title}</h2>
				{actions}
			</header>
			{/* min-h-0 lets the body scroll inside its grid cell instead of stretching the page */}
			<div className="min-h-0 flex-1 overflow-auto">{children}</div>
		</section>
	);
}

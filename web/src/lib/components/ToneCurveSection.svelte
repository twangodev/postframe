<script lang="ts">
	import { Tabs } from 'bits-ui';
	import Panel from './ui/Panel.svelte';
	import {
		CURVE_CHANNEL_NAMES,
		identityCurve,
		type CurveChannelName,
		type CurvePoint,
		type CurvePoints
	} from '$lib/develop-settings';
	import { addCurvePoint, curveSamples, draggedCurve, nearestCurvePoint } from '$lib/tone-curve';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const GRAB_RADIUS = 0.06;
	const PLOT_SAMPLES = 97;
	const CHANNEL_STROKE: Record<CurveChannelName, string> = {
		luminance: 'var(--color-text)',
		red: '#f87171',
		green: '#69d68b',
		blue: '#74a8f8'
	};

	let channel = $state<CurveChannelName>('luminance');
	let plot: SVGSVGElement | undefined = $state();
	let drag = $state<{ index: number; from: CurvePoints } | null>(null);

	const points = $derived(workspace.curve[channel]);
	const disabled = $derived(!workspace.canAdjustLight);
	const shape = $derived(
		curveSamples(points, PLOT_SAMPLES)
			.map((y, index) => `${(index / (PLOT_SAMPLES - 1)) * 100},${(1 - y) * 100}`)
			.join(' ')
	);

	function positionOf(event: PointerEvent): CurvePoint {
		const bounds = plot!.getBoundingClientRect();
		return {
			x: (event.clientX - bounds.left) / bounds.width,
			y: 1 - (event.clientY - bounds.top) / bounds.height
		};
	}

	function grab(event: PointerEvent) {
		if (disabled || event.button !== 0 || event.detail > 1) return;
		const position = positionOf(event);
		const shaped =
			nearestCurvePoint(points, position, GRAB_RADIUS) === null
				? addCurvePoint(points, position)
				: points;
		const index = nearestCurvePoint(shaped, position, GRAB_RADIUS);
		if (index === null) return;
		drag = { index, from: shaped.map(({ x, y }) => ({ x, y })) };
		plot?.setPointerCapture(event.pointerId);
		if (shaped !== points) workspace.previewCurve(channel, drag.from);
	}

	function move(event: PointerEvent) {
		if (!drag) return;
		workspace.previewCurve(channel, draggedCurve(drag.from, drag.index, positionOf(event)));
	}

	function release(event: PointerEvent) {
		if (!drag) return;
		const shaped = draggedCurve(drag.from, drag.index, positionOf(event));
		drag = null;
		workspace.commitCurve(channel, shaped);
	}

	function reset() {
		if (disabled) return;
		drag = null;
		workspace.commitCurve(channel, identityCurve());
	}
</script>

<Panel title="Curve" open={false} meta={channel}>
	<Tabs.Root bind:value={channel} class="space-y-2">
		<Tabs.List class="grid grid-cols-4 gap-1">
			{#each CURVE_CHANNEL_NAMES as name (name)}
				<Tabs.Trigger
					value={name}
					{disabled}
					class="h-6 cursor-pointer rounded border border-transparent text-[11px] text-muted lowercase data-[state=active]:border-subtle data-[state=active]:bg-surface data-[state=active]:text-text"
				>
					{name === 'luminance' ? 'lum' : name}
				</Tabs.Trigger>
			{/each}
		</Tabs.List>

		<svg
			bind:this={plot}
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
			role="application"
			aria-label="{channel} tone curve"
			aria-disabled={disabled}
			class="aspect-square w-full touch-none rounded border border-subtle bg-surface {disabled
				? 'opacity-50'
				: 'cursor-crosshair'}"
			onpointerdown={grab}
			onpointermove={move}
			onpointerup={release}
			onpointercancel={release}
			ondblclick={reset}
		>
			{#each [25, 50, 75] as offset (offset)}
				<line x1={offset} y1="0" x2={offset} y2="100" stroke="currentColor" opacity="0.12" />
				<line x1="0" y1={offset} x2="100" y2={offset} stroke="currentColor" opacity="0.12" />
			{/each}
			<line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" opacity="0.25" />
			<polyline
				points={shape}
				fill="none"
				stroke={CHANNEL_STROKE[channel]}
				stroke-width="1.5"
				vector-effect="non-scaling-stroke"
			/>
			{#each points as point, index (index)}
				<circle
					cx={point.x * 100}
					cy={(1 - point.y) * 100}
					r="2.5"
					fill={CHANNEL_STROKE[channel]}
				/>
			{/each}
		</svg>

		<p class="text-[11px] text-muted lowercase">
			click to add a point, drag one out to remove it, double-click to reset
		</p>
	</Tabs.Root>
</Panel>

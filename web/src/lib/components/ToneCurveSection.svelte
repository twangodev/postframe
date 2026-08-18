<script lang="ts">
	import Panel from './ui/Panel.svelte';
	import {
		CURVE_CHANNEL_NAMES,
		identityCurve,
		isIdentityCurve,
		type CurveChannelName,
		type CurvePoint,
		type CurvePoints
	} from '$lib/develop-settings';
	import { histogramProfile } from '$lib/image-scope';
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
	const CHANNEL_LABEL: Record<CurveChannelName, string> = {
		luminance: 'L',
		red: 'R',
		green: 'G',
		blue: 'B'
	};
	// The scope packs its bins as red, green, blue, then luma.
	const CHANNEL_BIN: Record<CurveChannelName, number> = {
		luminance: 3,
		red: 0,
		green: 1,
		blue: 2
	};

	type PlotEvent = PointerEvent & { currentTarget: SVGSVGElement };

	let channel = $state<CurveChannelName>('luminance');
	let drag = $state<{ index: number; from: CurvePoints } | null>(null);

	const points = $derived(workspace.curve[channel]);
	const disabled = $derived(!workspace.canAdjustLight);
	const shaped = $derived(
		CURVE_CHANNEL_NAMES.filter((name) => !isIdentityCurve(workspace.curve[name]))
	);
	// Every shaped channel stays on the plot; the chip only decides which one
	// takes the next drag.
	const drawn = $derived(
		CURVE_CHANNEL_NAMES.filter((name) => name === channel || shaped.includes(name)).sort((left) =>
			left === channel ? 1 : -1
		)
	);
	const histogram = $derived(
		workspace.imageScope
			? histogramProfile(workspace.imageScope.histogram, CHANNEL_BIN[channel])
			: null
	);
	const backdrop = $derived(
		histogram
			? `0,100 ${histogram
					.map((height, bin) => `${(bin / (histogram.length - 1)) * 100},${(1 - height) * 100}`)
					.join(' ')} 100,100`
			: null
	);

	function trace(name: CurveChannelName) {
		return curveSamples(workspace.curve[name], PLOT_SAMPLES)
			.map((y, index) => `${(index / (PLOT_SAMPLES - 1)) * 100},${(1 - y) * 100}`)
			.join(' ');
	}

	function positionOf(event: PlotEvent): CurvePoint {
		const bounds = event.currentTarget.getBoundingClientRect();
		return {
			x: (event.clientX - bounds.left) / bounds.width,
			y: 1 - (event.clientY - bounds.top) / bounds.height
		};
	}

	function grab(event: PlotEvent) {
		if (disabled || event.button !== 0 || event.detail > 1) return;
		const position = positionOf(event);
		const next =
			nearestCurvePoint(points, position, GRAB_RADIUS) === null
				? addCurvePoint(points, position)
				: points;
		const index = nearestCurvePoint(next, position, GRAB_RADIUS);
		if (index === null) return;
		drag = { index, from: next.map(({ x, y }) => ({ x, y })) };
		event.currentTarget.setPointerCapture(event.pointerId);
		if (next !== points) workspace.previewCurve(channel, drag.from);
	}

	function move(event: PlotEvent) {
		if (!drag) return;
		workspace.previewCurve(channel, draggedCurve(drag.from, drag.index, positionOf(event)));
	}

	function release(event: PlotEvent) {
		if (!drag) return;
		const next = draggedCurve(drag.from, drag.index, positionOf(event));
		drag = null;
		workspace.commitCurve(channel, next);
	}

	function reset() {
		if (disabled) return;
		drag = null;
		workspace.commitCurve(channel, identityCurve());
	}
</script>

<Panel
	title="Curve"
	open={false}
	meta={shaped.length ? shaped.map((n) => CHANNEL_LABEL[n]).join('') : 'linear'}
>
	<div class="space-y-2">
		<div class="flex gap-1" role="radiogroup" aria-label="Tone curve channel">
			{#each CURVE_CHANNEL_NAMES as name (name)}
				<button
					type="button"
					role="radio"
					aria-checked={channel === name}
					aria-label="{name} curve"
					{disabled}
					onclick={() => (channel = name)}
					class="h-6 flex-1 cursor-pointer rounded border text-[11px] transition-colors disabled:cursor-default {channel ===
					name
						? 'border-subtle bg-surface'
						: 'border-transparent hover:border-subtle'}"
					style:color={channel === name || shaped.includes(name)
						? CHANNEL_STROKE[name]
						: 'var(--color-muted)'}
				>
					{CHANNEL_LABEL[name]}
				</button>
			{/each}
		</div>

		<svg
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
			{#if backdrop}
				<polygon points={backdrop} fill="currentColor" opacity="0.14" />
			{/if}
			{#each [25, 50, 75] as offset (offset)}
				<line x1={offset} y1="0" x2={offset} y2="100" stroke="currentColor" opacity="0.12" />
				<line x1="0" y1={offset} x2="100" y2={offset} stroke="currentColor" opacity="0.12" />
			{/each}
			<line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" opacity="0.25" />
			{#each drawn as name (name)}
				<polyline
					points={trace(name)}
					fill="none"
					stroke={CHANNEL_STROKE[name]}
					stroke-width={name === channel ? 1.5 : 1}
					opacity={name === channel ? 1 : 0.45}
					vector-effect="non-scaling-stroke"
				/>
			{/each}
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
	</div>
</Panel>

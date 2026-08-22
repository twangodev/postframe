<script lang="ts">
	import Panel from './ui/Panel.svelte';
	import SegmentedControl from './ui/SegmentedControl.svelte';
	import {
		CURVE_CHANNEL_NAMES,
		identityCurve,
		isIdentityCurve,
		type CurveChannelName,
		type CurvePoint,
		type CurvePoints
	} from '$lib/develop-settings';
	import type { DevelopBinding } from '$lib/develop-binding';
	import { histogramProfile, type HistogramChannel, type ImageScopeData } from '$lib/image-scope';
	import { pointerFraction } from '$lib/pointer-fraction';
	import { addCurvePoint, curveSamples, draggedCurve, nearestCurvePoint } from '$lib/tone-curve';
	import type { ControlRevealPhase } from '$lib/adjustment-reveal';

	interface Props {
		binding: DevelopBinding;
		scope?: ImageScopeData | null;
		open?: boolean;
		revealedChannels?: readonly CurveChannelName[];
		revealPhase?: ControlRevealPhase;
		onRevealInteraction?: (channel: CurveChannelName) => void;
		disabled?: boolean;
	}

	let {
		binding,
		scope = null,
		open = $bindable(false),
		revealedChannels = [],
		revealPhase = 'idle',
		onRevealInteraction = () => {},
		disabled: disabledByPresentation = false
	}: Props = $props();

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
	const CHANNEL_SOURCE: Record<CurveChannelName, HistogramChannel> = {
		luminance: 'luma',
		red: 'red',
		green: 'green',
		blue: 'blue'
	};

	type PlotEvent = PointerEvent & { currentTarget: SVGSVGElement };

	let channel = $state<CurveChannelName>('luminance');
	let drag = $state<{ index: number; from: CurvePoints } | null>(null);

	const points = $derived(binding.curve[channel]);
	const revealCount = $derived(revealedChannels.length);
	const revealing = $derived(revealPhase === 'targeting' || revealPhase === 'moving');
	const disabled = $derived(binding.disabled || disabledByPresentation);
	const shaped = $derived(
		CURVE_CHANNEL_NAMES.filter((name) => !isIdentityCurve(binding.curve[name]))
	);
	const drawn = $derived(
		activeChannelOnTop(
			CURVE_CHANNEL_NAMES.filter((name) => name === channel || shaped.includes(name))
		)
	);
	const histogram = $derived(
		scope ? histogramProfile(scope.histogram, CHANNEL_SOURCE[channel]) : null
	);
	const backdrop = $derived(
		histogram
			? `0,100 ${histogram
					.map((height, bin) => `${(bin / (histogram.length - 1)) * 100},${(1 - height) * 100}`)
					.join(' ')} 100,100`
			: null
	);

	function activeChannelOnTop(names: CurveChannelName[]) {
		return names.sort((left) => (left === channel ? 1 : -1));
	}

	function trace(name: CurveChannelName) {
		return curveSamples(binding.curve[name], PLOT_SAMPLES)
			.map((y, index) => `${(index / (PLOT_SAMPLES - 1)) * 100},${(1 - y) * 100}`)
			.join(' ');
	}

	function positionOf(event: PlotEvent): CurvePoint {
		const { x, y } = pointerFraction(event, event.currentTarget);
		return { x, y: 1 - y };
	}

	function grab(event: PlotEvent) {
		if (disabled || event.button !== 0 || event.detail > 1) return;
		if (revealing) onRevealInteraction(channel);
		const position = positionOf(event);
		const next =
			nearestCurvePoint(points, position, GRAB_RADIUS) === null
				? addCurvePoint(points, position)
				: points;
		const index = nearestCurvePoint(next, position, GRAB_RADIUS);
		if (index === null) return;
		drag = { index, from: next.map(({ x, y }) => ({ x, y })) };
		event.currentTarget.setPointerCapture(event.pointerId);
		if (next !== points) binding.previewCurve(channel, drag.from);
	}

	function move(event: PlotEvent) {
		if (!drag) return;
		binding.previewCurve(channel, draggedCurve(drag.from, drag.index, positionOf(event)));
	}

	function release(event: PlotEvent) {
		if (!drag) return;
		const next = draggedCurve(drag.from, drag.index, positionOf(event));
		drag = null;
		binding.commitCurve(channel, next);
	}

	function reset() {
		if (disabled) return;
		if (revealing) onRevealInteraction(channel);
		drag = null;
		binding.commitCurve(channel, identityCurve());
	}

	$effect(() => {
		if (revealedChannels.length > 0 && revealPhase !== 'idle') channel = revealedChannels[0];
	});
</script>

{#snippet channelChip(name: CurveChannelName)}
	{CHANNEL_LABEL[name]}
{/snippet}

<Panel
	title="Curve"
	bind:open
	meta={shaped.length ? shaped.map((n) => CHANNEL_LABEL[n]).join('') : 'linear'}
	{revealCount}
>
	<div class="space-y-2">
		<SegmentedControl
			options={CURVE_CHANNEL_NAMES}
			bind:value={channel}
			label="Tone curve channel"
			{disabled}
			itemLabel={(name) => `${name} curve`}
			itemClass="border-transparent text-[11px] hover:border-subtle disabled:cursor-default data-[state=on]:border-subtle data-[state=on]:bg-surface"
			itemStyle={(name) =>
				`color: ${channel === name || shaped.includes(name) ? CHANNEL_STROKE[name] : 'var(--color-muted)'}; ${revealedChannels.includes(name) ? 'box-shadow: inset 0 0 0 1px var(--color-accent)' : ''}`}
			item={channelChip}
		/>

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
				{#if revealedChannels.includes(channel)}
					<circle
						aria-hidden="true"
						data-curve-reveal-halo
						data-phase={revealPhase}
						class="curve-reveal-halo"
						cx={point.x * 100}
						cy={(1 - point.y) * 100}
						r="3"
						fill="none"
						stroke="var(--color-accent)"
						stroke-width="0.8"
						vector-effect="non-scaling-stroke"
					/>
				{/if}
				<circle cx={point.x * 100} cy={(1 - point.y) * 100} r="2" fill={CHANNEL_STROKE[channel]} />
			{/each}
		</svg>

		<p class="text-[11px] text-muted lowercase">
			click to add a point, drag one out to remove it, double-click to reset
		</p>
	</div>
</Panel>

<style>
	.curve-reveal-halo {
		transform-box: fill-box;
		transform-origin: center;
	}

	.curve-reveal-halo[data-phase='targeting'] {
		animation: target-curve-control 250ms var(--ease-out) both;
	}

	.curve-reveal-halo[data-phase='moving'] {
		opacity: 0.65;
		scale: 0.95;
	}

	.curve-reveal-halo[data-phase='settled'] {
		opacity: 0.32;
		scale: 0.9;
	}

	@keyframes target-curve-control {
		from {
			opacity: 0;
			scale: 1.75;
		}
		to {
			opacity: 0.85;
			scale: 1;
		}
	}
</style>

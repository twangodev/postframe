<script lang="ts">
	import { ToggleGroup } from 'bits-ui';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import {
		CLIPPING_KINDS,
		clippedEnds,
		noClipping,
		type ClippingIndicators,
		type ClippingKind
	} from '$lib/clipping';
	import type { ImageScopeData, ImageScopeMode } from '$lib/image-scope';
	import { renderWaveformScope } from '$lib/image-scope-canvas';

	interface Props {
		data?: ImageScopeData | null;
		loading?: boolean;
		mode?: ImageScopeMode;
		clipping?: ClippingIndicators | null;
		onToggleClipping?: (kind: ClippingKind) => void;
	}

	let {
		data = null,
		loading = false,
		mode = $bindable('waveform'),
		clipping = null,
		onToggleClipping
	}: Props = $props();
	let canvas: HTMLCanvasElement;
	let dimensions = $state({ width: 0, height: 0 });
	let animationFrame: number | null = null;
	let painted = false;
	let paintedSize = '';
	let reduceMotion = $state(false);
	let Histogram = $state<typeof import('./ImageHistogram.svelte').default>();

	const label = $derived(mode === 'waveform' ? 'RGB waveform scope' : 'RGB histogram scope');
	const histogramReady = $derived(mode === 'histogram' && Histogram !== undefined);
	const footer = $derived(
		mode === 'waveform'
			? { start: '0', center: 'waveform', end: '100' }
			: { start: '0', center: 'histogram', end: '255' }
	);
	const clipped = $derived(data ? clippedEnds(data.histogram) : noClipping());
	const indicatorLabel: Record<ClippingKind, string> = {
		shadows: 'Show shadow clipping',
		highlights: 'Show highlight clipping'
	};
	const indicatorTone: Record<ClippingKind, string> = {
		shadows: 'bg-[#5f83ff]',
		highlights: 'bg-[#ff5968]'
	};

	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const resize = () => {
			const bounds = canvas.getBoundingClientRect();
			const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
			const width = Math.max(1, Math.round(bounds.width * pixelRatio));
			const height = Math.max(1, Math.round(bounds.height * pixelRatio));
			if (width === dimensions.width && height === dimensions.height) return;
			canvas.width = width;
			canvas.height = height;
			dimensions = { width, height };
		};
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		resize();
		return () => {
			observer.disconnect();
			if (animationFrame !== null) cancelAnimationFrame(animationFrame);
		};
	});

	$effect(() => {
		const scope = data;
		const { width, height } = dimensions;
		if (!canvas || width === 0 || height === 0) return;
		transitionTo(renderWaveformScope(canvas, scope, width, height), width, height);
	});

	$effect(() => {
		if (mode === 'histogram' && !Histogram) {
			import('./ImageHistogram.svelte').then(({ default: component }) => (Histogram = component));
		}
	});

	function selectMode(value: string) {
		if (value === 'waveform' || value === 'histogram') mode = value;
	}

	function transitionTo(target: HTMLCanvasElement, width: number, height: number) {
		if (animationFrame !== null) cancelAnimationFrame(animationFrame);
		const context = canvas.getContext('2d');
		if (!context) return;
		const size = `${width}:${height}`;
		if (!painted || paintedSize !== size || reduceMotion) {
			context.clearRect(0, 0, width, height);
			context.drawImage(target, 0, 0);
			painted = true;
			paintedSize = size;
			return;
		}

		const previous = canvas.ownerDocument.createElement('canvas');
		previous.width = width;
		previous.height = height;
		previous.getContext('2d')?.drawImage(canvas, 0, 0);
		const startedAt = performance.now();
		const animate = (now: number) => {
			const progress = Math.min(1, (now - startedAt) / 140);
			const eased = 1 - Math.pow(1 - progress, 3);
			context.globalAlpha = 1;
			context.drawImage(previous, 0, 0);
			context.globalAlpha = eased;
			context.drawImage(target, 0, 0);
			context.globalAlpha = 1;
			if (progress < 1) animationFrame = requestAnimationFrame(animate);
			else animationFrame = null;
		};
		animationFrame = requestAnimationFrame(animate);
	}
</script>

<div>
	<div class="mb-2 flex h-5 items-center justify-between">
		<span class="text-[10px] tracking-[0.04em] text-text/75 lowercase">scope</span>
		<ToggleGroup.Root
			type="single"
			value={mode}
			onValueChange={selectMode}
			aria-label="Image scope mode"
			class="flex h-5 rounded border border-subtle bg-canvas p-px"
		>
			<ToggleGroup.Item
				value="waveform"
				aria-label="Waveform scope"
				class="cursor-pointer rounded-sm px-1.5 text-[9px] text-muted lowercase transition-colors data-[state=on]:bg-elevated data-[state=on]:text-text"
			>
				waveform
			</ToggleGroup.Item>
			<ToggleGroup.Item
				value="histogram"
				aria-label="Histogram scope"
				class="cursor-pointer rounded-sm px-1.5 text-[9px] text-muted lowercase transition-colors data-[state=on]:bg-elevated data-[state=on]:text-text"
			>
				histogram
			</ToggleGroup.Item>
		</ToggleGroup.Root>
	</div>
	<div class="relative">
		<div
			role="img"
			aria-label={label}
			title={data ? `${data.sampleCount.toLocaleString()} preview samples` : label}
			class="relative h-28 overflow-hidden rounded-sm border border-subtle bg-canvas"
		>
			<canvas
				bind:this={canvas}
				aria-hidden="true"
				class:opacity-0={histogramReady}
				class="size-full transition-opacity duration-150"
			></canvas>
			{#if histogramReady && Histogram && data}
				<div class="absolute inset-0" transition:fade={{ duration: reduceMotion ? 0 : 140 }}>
					<Histogram {data} {reduceMotion} />
				</div>
			{/if}
			{#if !data}
				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] tracking-[0.04em] text-muted/55 lowercase"
				>
					{loading ? 'building scope' : 'scope unavailable'}
				</div>
			{/if}
		</div>
		{#if clipping && onToggleClipping}
			{#each CLIPPING_KINDS as kind (kind)}
				<button
					type="button"
					aria-label={indicatorLabel[kind]}
					aria-pressed={clipping[kind]}
					title={`${indicatorLabel[kind]} (J)`}
					onclick={() => onToggleClipping(kind)}
					class="absolute top-1.5 size-2.5 cursor-pointer rounded-[2px] border transition-colors {kind ===
					'shadows'
						? 'left-1.5'
						: 'right-1.5'} {clipped[kind] ? indicatorTone[kind] : 'bg-transparent'} {clipping[kind]
						? 'border-text shadow-[0_0_0_1px_var(--color-text)]'
						: 'border-muted/70 hover:border-text'}"
				></button>
			{/each}
		{/if}
	</div>
	<div class="mt-1.5 flex items-baseline justify-between text-[9px] text-muted">
		<span class="font-mono tabular-nums">{footer.start}</span>
		<span>{footer.center}</span>
		<span class="font-mono tabular-nums">{footer.end}</span>
	</div>
</div>

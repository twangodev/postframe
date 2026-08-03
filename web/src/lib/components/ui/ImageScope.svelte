<script lang="ts">
	import { ToggleGroup } from 'bits-ui';
	import { onMount } from 'svelte';
	import type { ImageScopeData, ImageScopeMode } from '$lib/image-scope';
	import { renderImageScope } from '$lib/image-scope-canvas';

	interface Props {
		data?: ImageScopeData | null;
		loading?: boolean;
		mode?: ImageScopeMode;
	}

	let { data = null, loading = false, mode = $bindable('waveform') }: Props = $props();
	let canvas: HTMLCanvasElement;
	let dimensions = $state({ width: 0, height: 0 });
	let animationFrame: number | null = null;
	let painted = false;
	let paintedSize = '';
	let reduceMotion = false;

	const label = $derived(mode === 'waveform' ? 'RGB waveform scope' : 'RGB histogram scope');
	const footer = $derived(
		mode === 'waveform'
			? { start: '0', center: 'waveform', end: '100' }
			: { start: '0', center: 'histogram', end: '255' }
	);

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
		const scopeMode = mode;
		const { width, height } = dimensions;
		if (!canvas || width === 0 || height === 0) return;
		transitionTo(renderImageScope(canvas, scope, scopeMode, width, height), width, height);
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
		<span class="text-text/75 text-[9px] tracking-[0.04em] lowercase">scope</span>
		<ToggleGroup.Root
			type="single"
			value={mode}
			onValueChange={selectMode}
			aria-label="Image scope mode"
			class="border-subtle bg-canvas flex h-5 rounded border p-px"
		>
			<ToggleGroup.Item
				value="waveform"
				aria-label="Waveform scope"
				class="text-muted data-[state=on]:bg-elevated data-[state=on]:text-text cursor-pointer rounded-sm px-1.5 text-[8px] lowercase transition-colors"
			>
				waveform
			</ToggleGroup.Item>
			<ToggleGroup.Item
				value="histogram"
				aria-label="Histogram scope"
				class="text-muted data-[state=on]:bg-elevated data-[state=on]:text-text cursor-pointer rounded-sm px-1.5 text-[8px] lowercase transition-colors"
			>
				histogram
			</ToggleGroup.Item>
		</ToggleGroup.Root>
	</div>
	<div
		role="img"
		aria-label={label}
		title={data ? `${data.sampleCount.toLocaleString()} preview samples` : label}
		class="bg-canvas border-subtle relative h-28 overflow-hidden rounded-sm border"
	>
		<canvas bind:this={canvas} aria-hidden="true" class="size-full"></canvas>
		{#if !data}
			<div
				class="text-muted/55 pointer-events-none absolute inset-0 flex items-center justify-center text-[8px] tracking-[0.04em] lowercase"
			>
				{loading ? 'building scope' : 'scope unavailable'}
			</div>
		{/if}
	</div>
	<div class="text-muted mt-1.5 flex items-baseline justify-between text-[8px]">
		<span class="font-mono tabular-nums">{footer.start}</span>
		<span>{footer.center}</span>
		<span class="font-mono tabular-nums">{footer.end}</span>
	</div>
</div>

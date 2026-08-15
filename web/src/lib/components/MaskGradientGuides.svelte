<script lang="ts">
	import type { NormalizedPoint } from '$lib/edit-document';

	interface Props {
		linear?: { start: NormalizedPoint; end: NormalizedPoint } | null;
		radial?: { center: NormalizedPoint; radius: number; feather: number } | null;
		imageWidth: number;
		imageHeight: number;
		viewportScale: number;
	}

	let { linear = null, radial = null, imageWidth, imageHeight, viewportScale }: Props = $props();

	const outerStroke = $derived(3 / viewportScale);
	const innerStroke = $derived(1 / viewportScale);
	const dashPattern = $derived(`${6 / viewportScale} ${4 / viewportScale}`);

	const linearGeometry = $derived.by(() => {
		if (!linear) return null;
		const start = { x: linear.start.x * imageWidth, y: linear.start.y * imageHeight };
		const end = { x: linear.end.x * imageWidth, y: linear.end.y * imageHeight };
		const length = Math.hypot(end.x - start.x, end.y - start.y);
		if (length < 1) return { start, end: null, across: null };
		const reach = Math.hypot(imageWidth, imageHeight);
		const across = {
			x: (-(end.y - start.y) / length) * reach,
			y: ((end.x - start.x) / length) * reach
		};
		return { start, end, across };
	});

	const radialGeometry = $derived.by(() => {
		if (!radial) return null;
		const center = { x: radial.center.x * imageWidth, y: radial.center.y * imageHeight };
		const edge = radial.radius * Math.max(imageWidth, imageHeight);
		return { center, edge, core: edge * (1 - radial.feather) };
	});
</script>

{#snippet guideLine(x1: number, y1: number, x2: number, y2: number, dash: string | null = null)}
	<line
		{x1}
		{y1}
		{x2}
		{y2}
		stroke="black"
		stroke-opacity="0.9"
		stroke-width={outerStroke}
		stroke-dasharray={dash}
	/>
	<line {x1} {y1} {x2} {y2} stroke="white" stroke-width={innerStroke} stroke-dasharray={dash} />
{/snippet}

{#snippet handleDot(x: number, y: number)}
	<circle
		cx={x}
		cy={y}
		r={3 / viewportScale}
		fill="white"
		stroke="black"
		stroke-width={innerStroke}
	/>
{/snippet}

<svg
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 size-full overflow-visible"
	viewBox={`0 0 ${imageWidth} ${imageHeight}`}
	preserveAspectRatio="none"
>
	{#if linearGeometry}
		{@const { start, end, across } = linearGeometry}
		{#if end && across}
			{@render guideLine(
				start.x - across.x,
				start.y - across.y,
				start.x + across.x,
				start.y + across.y
			)}
			{@render guideLine(end.x - across.x, end.y - across.y, end.x + across.x, end.y + across.y)}
			{@render guideLine(start.x, start.y, end.x, end.y, dashPattern)}
			{@render handleDot(end.x, end.y)}
		{/if}
		{@render handleDot(start.x, start.y)}
	{/if}
	{#if radialGeometry}
		{@const { center, edge, core } = radialGeometry}
		<circle
			cx={center.x}
			cy={center.y}
			r={edge}
			fill="none"
			stroke="black"
			stroke-opacity="0.9"
			stroke-width={outerStroke}
		/>
		<circle
			cx={center.x}
			cy={center.y}
			r={edge}
			fill="none"
			stroke="white"
			stroke-width={innerStroke}
		/>
		{#if core > 0 && core < edge}
			<circle
				cx={center.x}
				cy={center.y}
				r={core}
				fill="none"
				stroke="black"
				stroke-opacity="0.9"
				stroke-width={outerStroke}
				stroke-dasharray={dashPattern}
			/>
			<circle
				cx={center.x}
				cy={center.y}
				r={core}
				fill="none"
				stroke="white"
				stroke-opacity="0.7"
				stroke-width={innerStroke}
				stroke-dasharray={dashPattern}
			/>
		{/if}
		<circle
			cx={center.x}
			cy={center.y}
			r={1.5 / viewportScale}
			fill="white"
			stroke="black"
			stroke-width={innerStroke}
		/>
	{/if}
</svg>

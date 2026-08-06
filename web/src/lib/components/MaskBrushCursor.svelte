<script lang="ts">
	import type { NormalizedPoint } from '$lib/edit-document';

	interface Props {
		point: NormalizedPoint;
		radius: number;
		imageWidth: number;
		imageHeight: number;
		viewportScale: number;
	}

	let { point, radius, imageWidth, imageHeight, viewportScale }: Props = $props();
	const center = $derived({ x: point.x * imageWidth, y: point.y * imageHeight });
	const sourceRadius = $derived(radius * Math.max(imageWidth, imageHeight));
	const outerStroke = $derived(3 / viewportScale);
	const innerStroke = $derived(1 / viewportScale);
	const centerRadius = $derived(1.5 / viewportScale);
</script>

<svg
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 size-full overflow-visible"
	viewBox={`0 0 ${imageWidth} ${imageHeight}`}
	preserveAspectRatio="none"
>
	<circle
		cx={center.x}
		cy={center.y}
		r={sourceRadius}
		fill="none"
		stroke="black"
		stroke-opacity="0.9"
		stroke-width={outerStroke}
	/>
	<circle
		cx={center.x}
		cy={center.y}
		r={sourceRadius}
		fill="none"
		stroke="white"
		stroke-width={innerStroke}
	/>
	<circle
		cx={center.x}
		cy={center.y}
		r={centerRadius}
		fill="white"
		stroke="black"
		stroke-width={innerStroke}
	/>
</svg>

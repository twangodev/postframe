<script lang="ts">
	import type { NormalizedPoint } from '$lib/edit-document';

	interface Props {
		points: NormalizedPoint[];
		label: 'foreground' | 'background' | 'refine';
		imageWidth: number;
		imageHeight: number;
		viewportScale: number;
		brushRadius?: number;
	}

	let { points, label, imageWidth, imageHeight, viewportScale, brushRadius = 0 }: Props = $props();
	const coordinates = $derived(
		points.map(({ x, y }) => `${x * imageWidth},${y * imageHeight}`).join(' ')
	);
	const strokeWidth = $derived(
		brushRadius > 0 ? brushRadius * 2 * Math.max(imageWidth, imageHeight) : 7 / viewportScale
	);
</script>

<svg
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 size-full overflow-visible"
	viewBox={`0 0 ${imageWidth} ${imageHeight}`}
	preserveAspectRatio="none"
>
	<polyline
		points={coordinates}
		fill="none"
		class:stroke-negative={label === 'foreground'}
		class:stroke-bg={label === 'background'}
		class:stroke-accent={label === 'refine'}
		opacity={label === 'refine' ? 0.55 : 1}
		stroke-width={strokeWidth}
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
</svg>

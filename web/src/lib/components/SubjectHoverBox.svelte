<script lang="ts">
	import type { NormalizedRegion } from '$lib/edit-document';

	interface Props {
		box: NormalizedRegion;
		imageWidth: number;
		imageHeight: number;
		viewportScale: number;
	}

	let { box, imageWidth, imageHeight, viewportScale }: Props = $props();
</script>

<svg
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 size-full overflow-visible"
	viewBox={`0 0 ${imageWidth} ${imageHeight}`}
	preserveAspectRatio="none"
>
	<rect
		x={box.x * imageWidth}
		y={box.y * imageHeight}
		width={box.width * imageWidth}
		height={box.height * imageHeight}
		fill="none"
		class="stroke-accent"
		stroke-width={2 / viewportScale}
		stroke-dasharray={`${6 / viewportScale} ${4 / viewportScale}`}
	/>
</svg>

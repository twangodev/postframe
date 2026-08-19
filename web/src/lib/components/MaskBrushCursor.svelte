<script lang="ts">
	import ImageSpaceOverlay from './ui/ImageSpaceOverlay.svelte';
	import type { NormalizedPoint } from '$lib/edit-document';
	import { hairline, type OverlayFrame } from '$lib/overlay-frame';
	import { normalizedLength, normalizedToPixel } from '$lib/photo-viewport';

	interface Props {
		point: NormalizedPoint;
		radius: number;
		frame: OverlayFrame;
	}

	let { point, radius, frame }: Props = $props();
	const center = $derived(normalizedToPixel(point, frame.image));
	const sourceRadius = $derived(normalizedLength(radius, frame.image));
</script>

<ImageSpaceOverlay image={frame.image}>
	<circle
		cx={center.x}
		cy={center.y}
		r={sourceRadius}
		fill="none"
		stroke="black"
		stroke-opacity="0.9"
		stroke-width={hairline(frame, 3)}
	/>
	<circle
		cx={center.x}
		cy={center.y}
		r={sourceRadius}
		fill="none"
		stroke="white"
		stroke-width={hairline(frame)}
	/>
	<circle
		cx={center.x}
		cy={center.y}
		r={hairline(frame, 1.5)}
		fill="white"
		stroke="black"
		stroke-width={hairline(frame)}
	/>
</ImageSpaceOverlay>

<script lang="ts">
	import ImageSpaceOverlay from './ui/ImageSpaceOverlay.svelte';
	import type { NormalizedRegion } from '$lib/edit-document';
	import { dashes, hairline, type OverlayFrame } from '$lib/overlay-frame';

	interface Props {
		box: NormalizedRegion;
		frame: OverlayFrame;
	}

	let { box, frame }: Props = $props();
</script>

<ImageSpaceOverlay image={frame.image}>
	<rect
		x={box.x * frame.image.width}
		y={box.y * frame.image.height}
		width={box.width * frame.image.width}
		height={box.height * frame.image.height}
		fill="none"
		class="stroke-accent"
		stroke-width={hairline(frame, 2)}
		stroke-dasharray={dashes(frame)}
	/>
</ImageSpaceOverlay>

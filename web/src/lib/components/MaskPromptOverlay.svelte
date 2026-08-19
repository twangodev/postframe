<script lang="ts">
	import ImageSpaceOverlay from './ui/ImageSpaceOverlay.svelte';
	import type { NormalizedPoint } from '$lib/edit-document';
	import { hairline, type OverlayFrame } from '$lib/overlay-frame';
	import { normalizedLength, normalizedToPixel } from '$lib/photo-viewport';

	interface Props {
		points: NormalizedPoint[];
		label: 'foreground' | 'background' | 'refine';
		frame: OverlayFrame;
		brushRadius?: number;
	}

	let { points, label, frame, brushRadius = 0 }: Props = $props();
	const coordinates = $derived(
		points
			.map((point) => {
				const { x, y } = normalizedToPixel(point, frame.image);
				return `${x},${y}`;
			})
			.join(' ')
	);
	const strokeWidth = $derived(
		brushRadius > 0 ? normalizedLength(brushRadius * 2, frame.image) : hairline(frame, 7)
	);
</script>

<ImageSpaceOverlay image={frame.image}>
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
</ImageSpaceOverlay>

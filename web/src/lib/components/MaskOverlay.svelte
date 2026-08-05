<script lang="ts">
	import type { SelectedMaskRaster } from '$lib/workspace.svelte';
	import { maskEdgePreview, type MaskPreviewMode } from '$lib/mask-preview';

	interface Props {
		raster: SelectedMaskRaster;
		mode: MaskPreviewMode;
	}

	let { raster, mode }: Props = $props();
	let canvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		if (!canvas) return;
		canvas.width = raster.width;
		canvas.height = raster.height;
		const context = canvas.getContext('2d');
		if (!context) return;
		const alpha =
			mode === 'edge' ? maskEdgePreview(raster.alpha, raster.width, raster.height) : raster.alpha;
		const pixels = new Uint8ClampedArray(alpha.length * 4);
		for (let index = 0; index < raster.alpha.length; index += 1) {
			const offset = index * 4;
			const value = alpha[index] ?? 0;
			pixels[offset] = mode === 'matte' ? value : 255;
			pixels[offset + 1] = mode === 'matte' ? value : 255;
			pixels[offset + 2] = mode === 'matte' ? value : 255;
			pixels[offset + 3] = mode === 'matte' ? 255 : Math.round(value * 0.72);
		}
		context.putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
		if (mode === 'matte') return;
		context.globalCompositeOperation = 'source-in';
		context.fillStyle = getComputedStyle(canvas).color;
		context.fillRect(0, 0, raster.width, raster.height);
	});
</script>

<canvas
	bind:this={canvas}
	aria-hidden="true"
	class="motion-mask pointer-events-none size-full object-fill"
	class:text-negative={mode !== 'matte'}
	class:mix-blend-screen={mode !== 'matte'}
></canvas>

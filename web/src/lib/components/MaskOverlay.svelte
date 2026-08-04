<script lang="ts">
	import type { SelectedMaskRaster } from '$lib/workspace.svelte';

	interface Props {
		raster: SelectedMaskRaster;
	}

	let { raster }: Props = $props();
	let canvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		if (!canvas) return;
		canvas.width = raster.width;
		canvas.height = raster.height;
		const context = canvas.getContext('2d');
		if (!context) return;
		const pixels = new Uint8ClampedArray(raster.alpha.length * 4);
		for (let index = 0; index < raster.alpha.length; index += 1) {
			const offset = index * 4;
			pixels[offset] = 255;
			pixels[offset + 1] = 255;
			pixels[offset + 2] = 255;
			pixels[offset + 3] = Math.round((raster.alpha[index] ?? 0) * 0.72);
		}
		context.putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
		context.globalCompositeOperation = 'source-in';
		context.fillStyle = getComputedStyle(canvas).color;
		context.fillRect(0, 0, raster.width, raster.height);
	});
</script>

<canvas
	bind:this={canvas}
	aria-hidden="true"
	class="motion-mask text-negative pointer-events-none size-full object-fill mix-blend-screen"
></canvas>

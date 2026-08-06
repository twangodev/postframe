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
		renderMask(canvas, raster, mode);
	});

	function renderMask(
		canvas: HTMLCanvasElement,
		source: SelectedMaskRaster,
		preview: MaskPreviewMode
	) {
		canvas.width = source.width;
		canvas.height = source.height;
		const context = canvas.getContext('2d');
		if (!context) return;
		const alpha =
			preview === 'edge'
				? maskEdgePreview(source.alpha, source.width, source.height)
				: source.alpha;
		const pixels = new Uint8ClampedArray(alpha.length * 4);
		for (let index = 0; index < source.alpha.length; index += 1) {
			const offset = index * 4;
			const value = alpha[index] ?? 0;
			pixels[offset] = preview === 'matte' ? value : 255;
			pixels[offset + 1] = preview === 'matte' ? value : 255;
			pixels[offset + 2] = preview === 'matte' ? value : 255;
			pixels[offset + 3] = preview === 'matte' ? 255 : Math.round(value * 0.46);
		}
		context.putImageData(new ImageData(pixels, source.width, source.height), 0, 0);
		if (preview === 'matte') return;
		context.globalCompositeOperation = 'source-in';
		context.fillStyle = getComputedStyle(canvas).color;
		context.fillRect(0, 0, source.width, source.height);
	}
</script>

<canvas
	bind:this={canvas}
	aria-hidden="true"
	class="motion-mask pointer-events-none size-full object-fill"
	class:text-mask-overlay={mode !== 'matte'}
></canvas>

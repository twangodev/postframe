<script lang="ts">
	import type { SelectedMaskRaster } from '$lib/workspace.svelte';
	import { maskBoundaryPreview, maskEdgePreview, type MaskPreviewMode } from '$lib/mask-preview';

	interface Props {
		raster: SelectedMaskRaster;
		mode: MaskPreviewMode;
	}

	let { raster, mode }: Props = $props();
	let fillCanvas = $state<HTMLCanvasElement | null>(null);
	let boundaryCanvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		if (!fillCanvas || !boundaryCanvas) return;
		renderFill(fillCanvas, raster, mode);
		renderBoundary(boundaryCanvas, raster, mode);
	});

	function renderFill(
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

	function renderBoundary(
		canvas: HTMLCanvasElement,
		source: SelectedMaskRaster,
		preview: MaskPreviewMode
	) {
		canvas.width = source.width;
		canvas.height = source.height;
		const context = canvas.getContext('2d');
		if (!context || preview !== 'overlay') return;
		const { edge, halo } = maskBoundaryPreview(source.alpha, source.width, source.height);
		const pixels = new Uint8ClampedArray(edge.length * 4);
		for (let index = 0; index < edge.length; index += 1) {
			const edgeAlpha = edge[index]! / 255;
			const haloAlpha = (halo[index]! / 255) * 0.9;
			const alpha = edgeAlpha + haloAlpha * (1 - edgeAlpha);
			const white = alpha === 0 ? 0 : Math.round((edgeAlpha / alpha) * 255);
			const offset = index * 4;
			pixels[offset] = white;
			pixels[offset + 1] = white;
			pixels[offset + 2] = white;
			pixels[offset + 3] = Math.round(alpha * 255);
		}
		context.putImageData(new ImageData(pixels, source.width, source.height), 0, 0);
	}
</script>

<div aria-hidden="true" class="motion-mask pointer-events-none absolute inset-0">
	<canvas
		bind:this={fillCanvas}
		class="absolute inset-0 size-full object-fill"
		class:text-mask-overlay={mode !== 'matte'}
	></canvas>
	<canvas bind:this={boundaryCanvas} class="absolute inset-0 size-full object-fill"></canvas>
</div>

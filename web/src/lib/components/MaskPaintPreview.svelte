<script lang="ts">
	import { linearLayout } from '$lib/mask-gizmo-linear';
	import { radialLayout } from '$lib/mask-gizmo-radial';
	import { paintRasterDimensions, stampCenters, type LivePaint } from '$lib/mask-rasterizer';
	import { MASK_OVERLAY_TINT_ALPHA, tintCoverage } from '$lib/mask-preview';
	import { maxDimension, normalizedLength, type Size } from '$lib/photo-viewport';

	interface Props {
		paint: LivePaint;
		image: Size;
		mode: 'overlay' | 'matte';
	}

	let { paint, image, mode }: Props = $props();
	let canvas = $state<HTMLCanvasElement | null>(null);
	const dims = $derived(paintRasterDimensions(image.width, image.height));
	const replacesCommittedMask = $derived(paint.kind !== 'brush');

	let shape: HTMLCanvasElement | null = null;
	let sprite: HTMLCanvasElement | null = null;
	let spriteKey = '';
	let stampedCount = 0;
	let strokeLength = 0;
	let frame: number | null = null;

	$effect(() => {
		void paint;
		void mode;
		void dims;
		if (!canvas || frame !== null) return;
		frame = requestAnimationFrame(() => {
			frame = null;
			draw();
		});
		return () => {
			if (frame !== null) cancelAnimationFrame(frame);
			frame = null;
		};
	});

	function draw() {
		const target = canvas;
		if (!target) return;
		const { width, height } = dims;
		const shapeContext = shapeContextFor(width, height);
		const targetContext = target.getContext('2d');
		if (!shapeContext || !targetContext) return;
		if (target.width !== width || target.height !== height) {
			target.width = width;
			target.height = height;
		}
		paintShape(shapeContext, width, height);
		composite(targetContext, shapeContext.canvas, width, height);
	}

	function shapeContextFor(width: number, height: number) {
		shape ??= document.createElement('canvas');
		if (shape.width !== width || shape.height !== height) {
			shape.width = width;
			shape.height = height;
			stampedCount = 0;
			strokeLength = 0;
		}
		return shape.getContext('2d');
	}

	function paintShape(context: CanvasRenderingContext2D, width: number, height: number) {
		if (paint.kind === 'linear') {
			context.clearRect(0, 0, width, height);
			const span = linearLayout(paint, { width, height });
			const gradient = context.createLinearGradient(
				span.negative.x,
				span.negative.y,
				span.positive.x,
				span.positive.y
			);
			gradient.addColorStop(0, 'rgba(255,255,255,0)');
			gradient.addColorStop(1, 'rgba(255,255,255,1)');
			context.fillStyle = gradient;
			context.fillRect(0, 0, width, height);
		} else if (paint.kind === 'radial') {
			context.clearRect(0, 0, width, height);
			const maxDim = maxDimension({ width, height });
			const disc = radialLayout(paint, { width, height }, 0);
			const core = Math.max(
				0,
				Math.min(disc.radiusXPx * (1 - paint.feather), disc.radiusXPx - 0.01)
			);
			context.save();
			context.translate(disc.center.x, disc.center.y);
			context.rotate(paint.rotation);
			context.scale(1, disc.radiusYPx / disc.radiusXPx);
			const gradient = context.createRadialGradient(0, 0, core, 0, 0, disc.radiusXPx);
			gradient.addColorStop(0, 'rgba(255,255,255,1)');
			gradient.addColorStop(1, 'rgba(255,255,255,0)');
			context.fillStyle = gradient;
			context.fillRect(-maxDim * 4, -maxDim * 4, maxDim * 8, maxDim * 8);
			context.restore();
		} else {
			stampNewPoints(context, paint, width, height);
		}
	}

	function stampNewPoints(
		context: CanvasRenderingContext2D,
		stroke: Extract<LivePaint, { kind: 'brush' }>,
		width: number,
		height: number
	) {
		if (stroke.points.length < strokeLength) {
			context.clearRect(0, 0, width, height);
			stampedCount = 0;
		}
		strokeLength = stroke.points.length;
		const radius = normalizedLength(stroke.size / 2, { width, height });
		const stamp = brushSprite(radius, stroke.feather, stroke.flow);
		const centers = stampCenters(stroke.points, width, height, Math.max(1, radius / 2));
		context.globalCompositeOperation = 'lighter';
		for (const center of centers.slice(stampedCount)) {
			context.drawImage(stamp, center.x - stamp.width / 2, center.y - stamp.height / 2);
		}
		context.globalCompositeOperation = 'source-over';
		stampedCount = centers.length;
	}

	function brushSprite(radius: number, feather: number, flow: number) {
		const key = `${radius}:${feather}:${flow}`;
		if (sprite && spriteKey === key) return sprite;
		const diameter = Math.max(1, Math.ceil(radius * 2));
		const dab = document.createElement('canvas');
		dab.width = diameter;
		dab.height = diameter;
		const context = dab.getContext('2d');
		if (context) {
			const center = diameter / 2;
			const gradient = context.createRadialGradient(center, center, 0, center, center, radius);
			gradient.addColorStop(0, `rgba(255,255,255,${flow})`);
			gradient.addColorStop(Math.max(0, 1 - feather), `rgba(255,255,255,${flow})`);
			gradient.addColorStop(1, 'rgba(255,255,255,0)');
			context.fillStyle = gradient;
			context.fillRect(0, 0, diameter, diameter);
		}
		sprite = dab;
		spriteKey = key;
		return dab;
	}

	function composite(
		context: CanvasRenderingContext2D,
		source: HTMLCanvasElement,
		width: number,
		height: number
	) {
		context.clearRect(0, 0, width, height);
		if (mode === 'matte') {
			if (replacesCommittedMask) {
				context.fillStyle = 'black';
				context.fillRect(0, 0, width, height);
			}
			context.drawImage(source, 0, 0);
			return;
		}
		context.globalAlpha = MASK_OVERLAY_TINT_ALPHA;
		context.drawImage(source, 0, 0);
		context.globalAlpha = 1;
		tintCoverage(context, width, height);
	}
</script>

<canvas
	bind:this={canvas}
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 size-full object-fill"
	class:text-mask-overlay={mode === 'overlay'}
></canvas>

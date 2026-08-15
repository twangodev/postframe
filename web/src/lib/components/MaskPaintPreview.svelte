<script lang="ts" module>
	import type { NormalizedPoint } from '$lib/edit-document';

	export type LivePaint =
		| { kind: 'linear'; start: NormalizedPoint; end: NormalizedPoint }
		| { kind: 'radial'; center: NormalizedPoint; radius: number; feather: number }
		| { kind: 'brush'; points: NormalizedPoint[]; size: number; feather: number; flow: number };
</script>

<script lang="ts">
	import { paintRasterDimensions, stampCenters } from '$lib/mask-rasterizer';
	import { MASK_OVERLAY_TINT_ALPHA } from '$lib/mask-preview';

	interface Props {
		paint: LivePaint;
		imageWidth: number;
		imageHeight: number;
		mode: 'overlay' | 'matte';
	}

	let { paint, imageWidth, imageHeight, mode }: Props = $props();
	let canvas = $state<HTMLCanvasElement | null>(null);
	const dims = $derived(paintRasterDimensions(imageWidth, imageHeight));

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
			const gradient = context.createLinearGradient(
				paint.start.x * width,
				paint.start.y * height,
				paint.end.x * width,
				paint.end.y * height
			);
			gradient.addColorStop(0, 'rgba(255,255,255,0)');
			gradient.addColorStop(1, 'rgba(255,255,255,1)');
			context.fillStyle = gradient;
			context.fillRect(0, 0, width, height);
		} else if (paint.kind === 'radial') {
			context.clearRect(0, 0, width, height);
			const edge = paint.radius * Math.max(width, height);
			const core = Math.max(0, Math.min(edge * (1 - paint.feather), edge - 0.01));
			const x = paint.center.x * width;
			const y = paint.center.y * height;
			const gradient = context.createRadialGradient(x, y, core, x, y, edge);
			gradient.addColorStop(0, 'rgba(255,255,255,1)');
			gradient.addColorStop(1, 'rgba(255,255,255,0)');
			context.fillStyle = gradient;
			context.fillRect(0, 0, width, height);
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
		const radius = (stroke.size / 2) * Math.max(width, height);
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
			context.fillStyle = 'black';
			context.fillRect(0, 0, width, height);
			context.drawImage(source, 0, 0);
			return;
		}
		context.globalAlpha = MASK_OVERLAY_TINT_ALPHA;
		context.drawImage(source, 0, 0);
		context.globalAlpha = 1;
		context.globalCompositeOperation = 'source-in';
		context.fillStyle = getComputedStyle(context.canvas).color;
		context.fillRect(0, 0, width, height);
		context.globalCompositeOperation = 'source-over';
	}
</script>

<canvas
	bind:this={canvas}
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 size-full object-fill"
	class:text-mask-overlay={mode === 'overlay'}
></canvas>

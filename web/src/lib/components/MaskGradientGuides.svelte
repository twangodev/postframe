<script lang="ts">
	import ImageSpaceOverlay from './ui/ImageSpaceOverlay.svelte';
	import { GIZMO_ROTATE_OFFSET_PX, type GizmoHit } from '$lib/mask-gizmo';
	import { linearLayout } from '$lib/mask-gizmo-linear';
	import { radialLayout } from '$lib/mask-gizmo-radial';
	import type { GradientComponent } from '$lib/mask-painting';
	import { dashes, hairline, type OverlayFrame } from '$lib/overlay-frame';

	interface Props {
		component: GradientComponent | null;
		hover: GizmoHit | null;
		active: GizmoHit | null;
		angle: { label: string; locked: boolean } | null;
		frame: OverlayFrame;
	}

	let { component, hover, active, angle, frame }: Props = $props();

	const image = $derived(frame.image);
	const grip = $derived(active ?? hover);
	const outerStroke = $derived(hairline(frame, 3));
	const innerStroke = $derived(hairline(frame));
	const dashPattern = $derived(dashes(frame));
	const reach = $derived(Math.hypot(image.width, image.height));

	const linear = $derived(component?.type === 'linear' ? linearLayout(component, image) : null);
	const radial = $derived(
		component?.type === 'radial'
			? radialLayout(component, image, hairline(frame, GIZMO_ROTATE_OFFSET_PX))
			: null
	);
	const core = $derived(component?.type === 'radial' ? 1 - component.feather : 0);
	const rotationDegrees = $derived(
		component?.type === 'radial' ? (component.rotation * 180) / Math.PI : 0
	);

	const anglePoint = $derived.by(() => {
		if (!angle || active?.kind !== 'handle') return null;
		if (linear) return active.handle === 'negative' ? linear.negative : linear.positive;
		if (radial && active.handle === 'rotate') return radial.rotate;
		return null;
	});

	function gripped(handle: string) {
		return grip?.kind === 'handle' && grip.handle === handle;
	}
</script>

{#snippet guideLine(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	dash: string | null = null,
	emphasized = false
)}
	<line
		{x1}
		{y1}
		{x2}
		{y2}
		stroke="black"
		stroke-opacity="0.9"
		stroke-width={outerStroke}
		stroke-dasharray={dash}
	/>
	<line
		{x1}
		{y1}
		{x2}
		{y2}
		stroke="white"
		stroke-width={emphasized ? 2 * innerStroke : innerStroke}
		stroke-dasharray={dash}
	/>
{/snippet}

{#snippet handleDot(x: number, y: number, emphasized = false)}
	<circle
		cx={x}
		cy={y}
		r={hairline(frame, emphasized ? 5.5 : 3.5)}
		fill="white"
		stroke="black"
		stroke-width={innerStroke}
	/>
{/snippet}

{#snippet ellipsePair(
	rx: number,
	ry: number,
	dash: string | null,
	emphasized: boolean,
	innerOpacity: string | null = null
)}
	<ellipse
		{rx}
		{ry}
		fill="none"
		stroke="black"
		stroke-opacity="0.9"
		stroke-width={outerStroke}
		stroke-dasharray={dash}
	/>
	<ellipse
		{rx}
		{ry}
		fill="none"
		stroke="white"
		stroke-opacity={innerOpacity}
		stroke-width={emphasized ? 2 * innerStroke : innerStroke}
		stroke-dasharray={dash}
	/>
{/snippet}

<ImageSpaceOverlay {image}>
	{#if linear}
		{@const across = { x: -linear.direction.y * reach, y: linear.direction.x * reach }}
		{@render guideLine(
			linear.negative.x - across.x,
			linear.negative.y - across.y,
			linear.negative.x + across.x,
			linear.negative.y + across.y,
			null,
			gripped('back')
		)}
		{@render guideLine(
			linear.positive.x - across.x,
			linear.positive.y - across.y,
			linear.positive.x + across.x,
			linear.positive.y + across.y,
			null,
			gripped('front')
		)}
		{@render guideLine(
			linear.anchor.x - across.x,
			linear.anchor.y - across.y,
			linear.anchor.x + across.x,
			linear.anchor.y + across.y,
			dashPattern,
			grip?.kind === 'body'
		)}
		{@render handleDot(linear.positive.x, linear.positive.y, gripped('positive'))}
		{@render handleDot(linear.negative.x, linear.negative.y, gripped('negative'))}
	{/if}
	{#if radial}
		<g transform={`translate(${radial.center.x} ${radial.center.y}) rotate(${rotationDegrees})`}>
			{@render ellipsePair(radial.radiusXPx, radial.radiusYPx, null, grip?.kind === 'body')}
			{#if core > 0 && core < 1}
				{@render ellipsePair(
					radial.radiusXPx * core,
					radial.radiusYPx * core,
					dashPattern,
					gripped('feather'),
					'0.7'
				)}
			{/if}
		</g>
		{@render guideLine(
			radial.majorPositive.x,
			radial.majorPositive.y,
			radial.rotate.x,
			radial.rotate.y,
			dashPattern,
			gripped('rotate')
		)}
		{@render handleDot(radial.majorPositive.x, radial.majorPositive.y, gripped('major-positive'))}
		{@render handleDot(radial.majorNegative.x, radial.majorNegative.y, gripped('major-negative'))}
		{@render handleDot(radial.minorPositive.x, radial.minorPositive.y, gripped('minor-positive'))}
		{@render handleDot(radial.minorNegative.x, radial.minorNegative.y, gripped('minor-negative'))}
		{@render handleDot(radial.rotate.x, radial.rotate.y, gripped('rotate'))}
		<circle
			cx={radial.center.x}
			cy={radial.center.y}
			r={hairline(frame, 1.5)}
			fill="white"
			stroke="black"
			stroke-width={innerStroke}
		/>
	{/if}
	{#if angle && anglePoint}
		<text
			x={anglePoint.x + hairline(frame, 14)}
			y={anglePoint.y - hairline(frame, 10)}
			fill="white"
			stroke="black"
			stroke-width={hairline(frame, angle.locked ? 4 : 3)}
			font-size={hairline(frame, 11)}
			font-weight={angle.locked ? 700 : 400}
			style="paint-order: stroke"
		>
			{angle.label}
		</text>
	{/if}
</ImageSpaceOverlay>

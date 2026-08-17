import type { EditMask } from './edit-document.ts';
import { entityId } from './entity-id.ts';
import {
	MIN_GRADIENT_EXTENT,
	pixelToNormalized,
	type GizmoHit,
	type GizmoModifiers
} from './mask-gizmo.ts';
import { hitTestLinear, reduceLinearDrag } from './mask-gizmo-linear.ts';
import { hitTestRadial, reduceRadialDrag } from './mask-gizmo-radial.ts';
import type { GradientComponent } from './mask-painting.ts';
import { withinImage, type Point, type Size } from './photo-viewport.ts';

export function hitTestGizmo(
	component: GradientComponent,
	point: Point,
	image: Size,
	tolerance: number,
	rotateOffset: number
): GizmoHit | null {
	return component.type === 'linear'
		? hitTestLinear(component, point, image, tolerance)
		: hitTestRadial(component, point, image, tolerance, rotateOffset);
}

export function reduceGizmoDrag(
	component: GradientComponent,
	grip: GizmoHit,
	origin: Point,
	point: Point,
	image: Size,
	modifiers: GizmoModifiers
): GradientComponent {
	return component.type === 'linear'
		? { ...component, ...reduceLinearDrag(component, grip, origin, point, image, modifiers) }
		: { ...component, ...reduceRadialDrag(component, grip, origin, point, image, modifiers) };
}

export function seedGizmoComponent(
	kind: 'linear' | 'radial',
	mask: EditMask,
	imagePoint: Point,
	image: Size
): { component: GradientComponent; grip: GizmoHit } | null {
	if (mask.kind !== kind || !withinImage(imagePoint, image)) return null;
	const existing = mask.components.find(
		(component): component is GradientComponent => component.type === kind
	);
	const base = {
		id: existing?.id ?? entityId('component'),
		operation: existing?.operation ?? ('add' as const),
		raster: null
	};
	const anchor = pixelToNormalized(imagePoint, image);
	if (kind === 'linear') {
		return {
			component: { ...base, type: 'linear', anchor, rotation: 0, compression: MIN_GRADIENT_EXTENT },
			grip: { kind: 'handle', handle: 'span' }
		};
	}
	return {
		component: {
			...base,
			type: 'radial',
			center: anchor,
			radiusX: MIN_GRADIENT_EXTENT,
			radiusY: MIN_GRADIENT_EXTENT,
			rotation: 0,
			feather: existing?.type === 'radial' ? existing.feather : 0.5
		},
		grip: { kind: 'handle', handle: 'radius' }
	};
}

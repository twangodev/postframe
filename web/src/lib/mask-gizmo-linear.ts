import {
	clampExtent,
	maxDimension,
	normalizedToPixel,
	pixelToNormalized,
	snapRotation,
	type GizmoHit,
	type GizmoModifiers,
	type LinearGizmoGeometry
} from './mask-gizmo.ts';
import type { Point, Size } from './photo-viewport.ts';

export interface LinearLayout {
	anchor: Point;
	direction: Point;
	reach: number;
	positive: Point;
	negative: Point;
}

export function linearLayout(geometry: LinearGizmoGeometry, image: Size): LinearLayout {
	const anchor = normalizedToPixel(geometry.anchor, image);
	const direction = { x: Math.cos(geometry.rotation), y: Math.sin(geometry.rotation) };
	const reach = geometry.compression * maxDimension(image);
	return {
		anchor,
		direction,
		reach,
		positive: { x: anchor.x + direction.x * reach, y: anchor.y + direction.y * reach },
		negative: { x: anchor.x - direction.x * reach, y: anchor.y - direction.y * reach }
	};
}

export function hitTestLinear(
	geometry: LinearGizmoGeometry,
	point: Point,
	image: Size,
	tolerance: number
): GizmoHit | null {
	const { anchor, direction, reach, positive, negative } = linearLayout(geometry, image);
	if (Math.hypot(point.x - positive.x, point.y - positive.y) <= tolerance)
		return { kind: 'handle', handle: 'positive' };
	if (Math.hypot(point.x - negative.x, point.y - negative.y) <= tolerance)
		return { kind: 'handle', handle: 'negative' };
	const along = (point.x - anchor.x) * direction.x + (point.y - anchor.y) * direction.y;
	if (Math.abs(along - reach) <= tolerance) return { kind: 'handle', handle: 'front' };
	if (Math.abs(along + reach) <= tolerance) return { kind: 'handle', handle: 'back' };
	if (Math.abs(along) <= tolerance) return { kind: 'body' };
	return null;
}

export function reduceLinearDrag(
	start: LinearGizmoGeometry,
	grip: GizmoHit,
	origin: Point,
	point: Point,
	image: Size,
	modifiers: GizmoModifiers
): LinearGizmoGeometry {
	if (grip.kind === 'body') {
		return {
			...start,
			anchor: pixelToNormalized(
				{
					x: start.anchor.x * image.width + (point.x - origin.x),
					y: start.anchor.y * image.height + (point.y - origin.y)
				},
				image
			)
		};
	}
	if (grip.handle === 'span') {
		const span = { x: point.x - origin.x, y: point.y - origin.y };
		const length = Math.hypot(span.x, span.y);
		if (length === 0) return start;
		return {
			...start,
			anchor: pixelToNormalized(
				{ x: (origin.x + point.x) / 2, y: (origin.y + point.y) / 2 },
				image
			),
			rotation: snapRotation(Math.atan2(span.y, span.x), modifiers.shift),
			compression: clampExtent(length / (2 * maxDimension(image)))
		};
	}
	const anchor = normalizedToPixel(start.anchor, image);
	if (grip.handle === 'positive' || grip.handle === 'negative') {
		const sign = grip.handle === 'positive' ? 1 : -1;
		const reach = { x: (point.x - anchor.x) * sign, y: (point.y - anchor.y) * sign };
		const length = Math.hypot(reach.x, reach.y);
		if (length === 0) return start;
		return {
			...start,
			rotation: snapRotation(Math.atan2(reach.y, reach.x), modifiers.shift),
			compression: clampExtent(length / maxDimension(image))
		};
	}
	const direction = { x: Math.cos(start.rotation), y: Math.sin(start.rotation) };
	const along = (point.x - anchor.x) * direction.x + (point.y - anchor.y) * direction.y;
	return { ...start, compression: clampExtent(Math.abs(along) / maxDimension(image)) };
}

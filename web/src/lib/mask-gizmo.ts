import { axisLockedDelta } from './drag-constraints.ts';
import type { LinearMaskGeometry, RadialMaskGeometry } from './mask-rasterizer.ts';
import {
	maxDimension,
	normalizedToPixel,
	pixelToNormalized,
	type Point,
	type Size
} from './photo-viewport.ts';

export { maxDimension, normalizedToPixel, pixelToNormalized };

export type LinearGizmoGeometry = LinearMaskGeometry;

export type RadialGizmoGeometry = RadialMaskGeometry;

export type GizmoHit = { kind: 'handle'; handle: string } | { kind: 'body' };

export interface GizmoModifiers {
	shift: boolean;
}

export const MIN_GRADIENT_EXTENT = 0.001;
export const GIZMO_HIT_TOLERANCE_PX = 10;
export const GIZMO_ROTATE_OFFSET_PX = 24;
export const GIZMO_DRAG_THRESHOLD_PX = 10;

export function clampExtent(value: number) {
	return Math.min(1, Math.max(MIN_GRADIENT_EXTENT, value));
}

export function draggedPoint(
	start: { x: number; y: number },
	origin: Point,
	point: Point,
	image: Size,
	modifiers: GizmoModifiers
) {
	const delta = axisLockedDelta({ x: point.x - origin.x, y: point.y - origin.y }, modifiers.shift);
	const pixel = normalizedToPixel(start, image);
	return pixelToNormalized({ x: pixel.x + delta.x, y: pixel.y + delta.y }, image);
}

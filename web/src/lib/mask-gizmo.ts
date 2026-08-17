import { axisLockedDelta } from './drag-constraints.ts';
import type { Point, Size } from './photo-viewport.ts';

export interface LinearGizmoGeometry {
	anchor: { x: number; y: number };
	rotation: number;
	compression: number;
}

export interface RadialGizmoGeometry {
	center: { x: number; y: number };
	radiusX: number;
	radiusY: number;
	rotation: number;
	feather: number;
}

export type GizmoHit = { kind: 'handle'; handle: string } | { kind: 'body' };

export interface GizmoModifiers {
	shift: boolean;
}

export const MIN_GRADIENT_EXTENT = 0.001;
export const GIZMO_HIT_TOLERANCE_PX = 10;
export const GIZMO_ROTATE_OFFSET_PX = 24;
export const GIZMO_DRAG_THRESHOLD_PX = 10;

export function maxDimension(image: Size) {
	return Math.max(image.width, image.height);
}

export function normalizedToPixel(point: { x: number; y: number }, image: Size): Point {
	return { x: point.x * image.width, y: point.y * image.height };
}

export function pixelToNormalized(point: Point, image: Size) {
	return {
		x: Math.min(1, Math.max(0, point.x / image.width)),
		y: Math.min(1, Math.max(0, point.y / image.height))
	};
}

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

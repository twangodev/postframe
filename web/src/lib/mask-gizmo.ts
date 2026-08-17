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

export function linearGeometryFromSpan(
	start: { x: number; y: number },
	end: { x: number; y: number },
	aspect: Size
): LinearGizmoGeometry {
	const maxDim = maxDimension(aspect);
	const axis = {
		x: ((end.x - start.x) * aspect.width) / maxDim,
		y: ((end.y - start.y) * aspect.height) / maxDim
	};
	const length = Math.hypot(axis.x, axis.y);
	return {
		anchor: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
		rotation: length === 0 ? 0 : Math.atan2(axis.y, axis.x),
		compression: clampExtent(length / 2)
	};
}

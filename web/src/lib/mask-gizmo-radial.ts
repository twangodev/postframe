import { normalizeRotation, snapRotation } from './drag-constraints.ts';
import {
	clampExtent,
	draggedPoint,
	maxDimension,
	normalizedToPixel,
	type GizmoHit,
	type GizmoModifiers,
	type RadialGizmoGeometry
} from './mask-gizmo.ts';
import type { Point, Size } from './photo-viewport.ts';

export interface RadialLayout {
	center: Point;
	majorDirection: Point;
	minorDirection: Point;
	radiusXPx: number;
	radiusYPx: number;
	majorPositive: Point;
	majorNegative: Point;
	minorPositive: Point;
	minorNegative: Point;
	rotate: Point;
}

export function radialLayout(
	geometry: RadialGizmoGeometry,
	image: Size,
	rotateOffset: number
): RadialLayout {
	const center = normalizedToPixel(geometry.center, image);
	const maxDim = maxDimension(image);
	const majorDirection = { x: Math.cos(geometry.rotation), y: Math.sin(geometry.rotation) };
	const minorDirection = { x: -majorDirection.y, y: majorDirection.x };
	const radiusXPx = geometry.radiusX * maxDim;
	const radiusYPx = geometry.radiusY * maxDim;
	const along = (direction: Point, reach: number) => ({
		x: center.x + direction.x * reach,
		y: center.y + direction.y * reach
	});
	return {
		center,
		majorDirection,
		minorDirection,
		radiusXPx,
		radiusYPx,
		majorPositive: along(majorDirection, radiusXPx),
		majorNegative: along(majorDirection, -radiusXPx),
		minorPositive: along(minorDirection, radiusYPx),
		minorNegative: along(minorDirection, -radiusYPx),
		rotate: along(majorDirection, radiusXPx + rotateOffset)
	};
}

// Nearest-point iteration on an axis-aligned ellipse, seeded at the 45° point.
// Three fixed steps converge well enough for hit-testing at every eccentricity.
export function ellipseOutlineDistance(local: Point, radiusX: number, radiusY: number): number {
	const px = Math.abs(local.x);
	const py = Math.abs(local.y);
	let tx = Math.SQRT1_2;
	let ty = Math.SQRT1_2;
	for (let step = 0; step < 3; step += 1) {
		const x = radiusX * tx;
		const y = radiusY * ty;
		const ex = ((radiusX * radiusX - radiusY * radiusY) * tx ** 3) / radiusX;
		const ey = ((radiusY * radiusY - radiusX * radiusX) * ty ** 3) / radiusY;
		const rx = x - ex;
		const ry = y - ey;
		const qx = px - ex;
		const qy = py - ey;
		const r = Math.hypot(rx, ry);
		const q = Math.hypot(qx, qy);
		tx = Math.min(1, Math.max(0, ((qx * r) / q + ex) / radiusX));
		ty = Math.min(1, Math.max(0, ((qy * r) / q + ey) / radiusY));
		const t = Math.hypot(tx, ty);
		tx /= t;
		ty /= t;
	}
	return Math.hypot(px - radiusX * tx, py - radiusY * ty);
}

function toEllipseSpace(point: Point, center: Point, majorDirection: Point): Point {
	const dx = point.x - center.x;
	const dy = point.y - center.y;
	return {
		x: dx * majorDirection.x + dy * majorDirection.y,
		y: dy * majorDirection.x - dx * majorDirection.y
	};
}

export function hitTestRadial(
	geometry: RadialGizmoGeometry,
	point: Point,
	image: Size,
	tolerance: number,
	rotateOffset: number
): GizmoHit | null {
	const layout = radialLayout(geometry, image, rotateOffset);
	const dots: Array<[string, Point]> = [
		['major-positive', layout.majorPositive],
		['major-negative', layout.majorNegative],
		['minor-positive', layout.minorPositive],
		['minor-negative', layout.minorNegative],
		['rotate', layout.rotate]
	];
	for (const [handle, dot] of dots) {
		if (Math.hypot(point.x - dot.x, point.y - dot.y) <= tolerance)
			return { kind: 'handle', handle };
	}
	const local = toEllipseSpace(point, layout.center, layout.majorDirection);
	const core = 1 - geometry.feather;
	if (
		core > 0 &&
		ellipseOutlineDistance(local, layout.radiusXPx * core, layout.radiusYPx * core) <= tolerance
	) {
		return { kind: 'handle', handle: 'feather' };
	}
	const reach = Math.hypot(local.x / layout.radiusXPx, local.y / layout.radiusYPx);
	if (reach <= 1) return { kind: 'body' };
	return null;
}

export function reduceRadialDrag(
	start: RadialGizmoGeometry,
	grip: GizmoHit,
	origin: Point,
	point: Point,
	image: Size,
	modifiers: GizmoModifiers
): RadialGizmoGeometry {
	const maxDim = maxDimension(image);
	const center = normalizedToPixel(start.center, image);
	if (grip.kind === 'body') {
		return { ...start, center: draggedPoint(start.center, origin, point, image, modifiers) };
	}
	const majorDirection = { x: Math.cos(start.rotation), y: Math.sin(start.rotation) };
	const local = toEllipseSpace(point, center, majorDirection);
	switch (grip.handle) {
		case 'radius': {
			const radius = clampExtent(Math.hypot(point.x - center.x, point.y - center.y) / maxDim);
			return { ...start, radiusX: radius, radiusY: radius };
		}
		case 'major-positive':
		case 'major-negative': {
			const radiusX = clampExtent(Math.abs(local.x) / maxDim);
			return modifiers.shift ? { ...start, radiusX, radiusY: radiusX } : { ...start, radiusX };
		}
		case 'minor-positive':
		case 'minor-negative': {
			const radiusY = clampExtent(Math.abs(local.y) / maxDim);
			return modifiers.shift ? { ...start, radiusX: radiusY, radiusY } : { ...start, radiusY };
		}
		case 'rotate': {
			const from = Math.atan2(origin.y - center.y, origin.x - center.x);
			const to = Math.atan2(point.y - center.y, point.x - center.x);
			return {
				...start,
				rotation: snapRotation(normalizeRotation(start.rotation + (to - from)), modifiers.shift)
			};
		}
		case 'feather': {
			const reach = Math.hypot(
				local.x / (start.radiusX * maxDim),
				local.y / (start.radiusY * maxDim)
			);
			return { ...start, feather: Math.min(1, Math.max(0, 1 - reach)) };
		}
		default:
			return start;
	}
}

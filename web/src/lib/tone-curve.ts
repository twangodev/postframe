import type { CurvePoint, CurvePoints } from './develop-settings';

/** Closest in x two control points may sit, so each stays grabbable. */
export const MINIMUM_POINT_GAP = 1 / 64;

/** How far past the plot a point must be dragged before it is dropped. */
export const REMOVE_MARGIN = 0.08;

/** The curve a drag describes: an interior point taken clear of the plot goes. */
export function draggedCurve(points: CurvePoints, index: number, at: CurvePoint): CurvePoints {
	return escapedThePlot(at) ? removeCurvePoint(points, index) : moveCurvePoint(points, index, at);
}

export function addCurvePoint(points: CurvePoints, at: CurvePoint): CurvePoints {
	const x = unitClamped(at.x);
	if (points.some((point) => Math.abs(point.x - x) < MINIMUM_POINT_GAP)) return points;
	const following = points.findIndex((point) => point.x > x);
	const added = [...points];
	added.splice(following === -1 ? points.length : following, 0, { x, y: unitClamped(at.y) });
	return added;
}

/**
 * Endpoints hold the ends of the range and so move vertically only; an interior
 * point stays strictly between its neighbours.
 */
export function moveCurvePoint(points: CurvePoints, index: number, at: CurvePoint): CurvePoints {
	return points.map((point, position) =>
		position === index ? { x: boundedX(points, index, at.x), y: unitClamped(at.y) } : point
	);
}

export function removeCurvePoint(points: CurvePoints, index: number): CurvePoints {
	if (isEndpoint(points, index)) return points;
	return points.filter((_, position) => position !== index);
}

export function nearestCurvePoint(points: CurvePoints, at: CurvePoint, radius: number) {
	const distances = points.map((point) => Math.hypot(point.x - at.x, point.y - at.y));
	const nearest = distances.indexOf(Math.min(...distances));
	return distances[nearest] <= radius ? nearest : null;
}

function boundedX(points: CurvePoints, index: number, x: number) {
	if (isEndpoint(points, index)) return index === 0 ? 0 : 1;
	const before = points[index - 1].x;
	const after = points[index + 1].x;
	const gap = Math.min(MINIMUM_POINT_GAP, (after - before) / 3);
	return Math.min(Math.max(x, before + gap), after - gap);
}

function isEndpoint(points: CurvePoints, index: number) {
	return index <= 0 || index >= points.length - 1;
}

function escapedThePlot({ x, y }: CurvePoint) {
	return [x, y].some((value) => value < -REMOVE_MARGIN || value > 1 + REMOVE_MARGIN);
}

function unitClamped(value: number) {
	return Math.min(Math.max(value, 0), 1);
}

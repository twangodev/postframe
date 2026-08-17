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

/**
 * Evenly spaced samples across the unit interval, interpolated the way
 * `src/curve.rs` resolves the same points, so the plot draws the curve the
 * pipeline applies rather than an approximation of it.
 */
export function curveSamples(points: CurvePoints, resolution: number) {
	const count = Math.max(2, resolution);
	const tangents = limitedTangents(points);
	return Array.from({ length: count }, (_, index) =>
		interpolate(points, tangents, index / (count - 1))
	);
}

function limitedTangents(points: CurvePoints) {
	const secants = points
		.slice(1)
		.map((point, index) => (point.y - points[index].y) / (point.x - points[index].x));
	const last = secants.length;
	const tangents = points.map((_, index) => {
		if (index === 0) return secants[0];
		if (index === last) return secants[last - 1];
		const [before, after] = [secants[index - 1], secants[index]];
		return before * after <= 0 ? 0 : (before + after) / 2;
	});
	secants.forEach((secant, index) => {
		const limit = 3 * Math.abs(secant);
		tangents[index] = Math.min(Math.max(tangents[index], -limit), limit);
		tangents[index + 1] = Math.min(Math.max(tangents[index + 1], -limit), limit);
	});
	return tangents;
}

function interpolate(points: CurvePoints, tangents: number[], x: number) {
	const first = points[0];
	const last = points[points.length - 1];
	if (x <= first.x) return unitClamped(first.y);
	if (x >= last.x) return unitClamped(last.y);
	const segment = points.findLastIndex((point) => point.x <= x);
	const [start, end] = [points[segment], points[segment + 1]];
	const width = end.x - start.x;
	const t = (x - start.x) / width;
	const [square, cube] = [t * t, t * t * t];
	return unitClamped(
		(2 * cube - 3 * square + 1) * start.y +
			(cube - 2 * square + t) * width * tangents[segment] +
			(-2 * cube + 3 * square) * end.y +
			(cube - square) * width * tangents[segment + 1]
	);
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

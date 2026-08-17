import assert from 'node:assert/strict';
import test from 'node:test';

import {
	curvePointsSchema,
	identityCurve,
	isIdentityCurve,
	type CurvePoints
} from '../src/lib/develop-settings.ts';
import {
	MINIMUM_POINT_GAP,
	REMOVE_MARGIN,
	addCurvePoint,
	curveSamples,
	draggedCurve,
	moveCurvePoint,
	nearestCurvePoint,
	removeCurvePoint
} from '../src/lib/tone-curve.ts';

function ascending(points: CurvePoints) {
	return points.every((point, index) => index === 0 || point.x > points[index - 1].x);
}

function assertValid(points: CurvePoints) {
	assert.ok(ascending(points), `not ascending in x: ${JSON.stringify(points)}`);
	assert.deepEqual(curvePointsSchema.parse(points), points);
}

test('adding points keeps the curve sorted by x', () => {
	let curve = identityCurve();
	for (const x of [0.7, 0.2, 0.45]) curve = addCurvePoint(curve, { x, y: x * x });
	assert.deepEqual(
		curve.map(({ x }) => x),
		[0, 0.2, 0.45, 0.7, 1]
	);
	assertValid(curve);
});

test('adding a point clamps it into the plot and refuses to crowd its neighbours', () => {
	assert.deepEqual(addCurvePoint(identityCurve(), { x: 0.5, y: 4 }), [
		{ x: 0, y: 0 },
		{ x: 0.5, y: 1 },
		{ x: 1, y: 1 }
	]);
	const crowded = addCurvePoint(identityCurve(), { x: MINIMUM_POINT_GAP / 2, y: 0.5 });
	assert.deepEqual(crowded, identityCurve());
});

test('dragging an interior point cannot pass its neighbours', () => {
	const curve = addCurvePoint(identityCurve(), { x: 0.5, y: 0.5 });
	const left = moveCurvePoint(curve, 1, { x: -2, y: 0.3 });
	const right = moveCurvePoint(curve, 1, { x: 2, y: 0.3 });
	assert.ok(left[1].x > 0 && left[1].x < 1);
	assert.ok(right[1].x > 0 && right[1].x < 1);
	assertValid(left);
	assertValid(right);
});

test('dragging an endpoint moves it vertically only', () => {
	const curve = identityCurve();
	assert.deepEqual(moveCurvePoint(curve, 0, { x: 0.8, y: 0.25 }), [
		{ x: 0, y: 0.25 },
		{ x: 1, y: 1 }
	]);
	assert.deepEqual(moveCurvePoint(curve, 1, { x: 0.1, y: -3 }), [
		{ x: 0, y: 0 },
		{ x: 1, y: 0 }
	]);
});

test('dragging a point clear of the plot drops it', () => {
	const curve = addCurvePoint(identityCurve(), { x: 0.5, y: 0.8 });
	assert.deepEqual(draggedCurve(curve, 1, { x: 0.5, y: 1 + REMOVE_MARGIN * 2 }), identityCurve());
	assert.deepEqual(draggedCurve(curve, 1, { x: 0.5, y: 0.9 })[1], { x: 0.5, y: 0.9 });
});

test('the last two points survive every drag and delete', () => {
	const curve = identityCurve();
	assert.deepEqual(removeCurvePoint(curve, 0), curve);
	assert.deepEqual(removeCurvePoint(curve, 1), curve);
	assert.deepEqual(draggedCurve(curve, 0, { x: -1, y: -1 }), [
		{ x: 0, y: 0 },
		{ x: 1, y: 1 }
	]);
});

test('the nearest point is only picked up within its grab radius', () => {
	const curve = addCurvePoint(identityCurve(), { x: 0.5, y: 0.5 });
	assert.equal(nearestCurvePoint(curve, { x: 0.52, y: 0.53 }, 0.05), 1);
	assert.equal(nearestCurvePoint(curve, { x: 0.52, y: 0.53 }, 0.01), null);
	assert.equal(nearestCurvePoint(curve, { x: 0.99, y: 0.98 }, 0.05), 2);
});

// The plot has to draw the curve the pipeline applies, so these mirror the
// monotone-interpolation tests in src/curve.rs.
test('the plotted curve reproduces the identity', () => {
	assert.deepEqual(curveSamples(identityCurve(), 5), [0, 0.25, 0.5, 0.75, 1]);
});

test('the plotted curve passes through its control points without overshooting', () => {
	const control = [
		{ x: 0, y: 0 },
		{ x: 0.25, y: 0.85 },
		{ x: 0.5, y: 0.9 },
		{ x: 1, y: 1 }
	];
	const samples = curveSamples(control, 401);
	for (const { x, y } of control) {
		assert.ok(Math.abs(samples[Math.round(x * 400)] - y) < 0.002, `missed (${x}, ${y})`);
	}
	assert.ok(
		samples.every((sample, index) => index === 0 || sample >= samples[index - 1]),
		'plotted curve reverses'
	);
	assert.ok(Math.max(...samples.slice(0, 101)) <= 0.85 + 0.002, 'plotted curve overshoots');
});

test('resetting an edited curve restores the identity exactly', () => {
	const edited = moveCurvePoint(addCurvePoint(identityCurve(), { x: 0.4, y: 0.6 }), 0, {
		x: 0,
		y: 0.1
	});
	assert.equal(isIdentityCurve(edited), false);
	assert.deepEqual(identityCurve(), [
		{ x: 0, y: 0 },
		{ x: 1, y: 1 }
	]);
	assert.equal(isIdentityCurve(identityCurve()), true);
});

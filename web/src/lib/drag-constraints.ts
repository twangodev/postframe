import type { Point } from './photo-viewport.ts';

export const ROTATION_SNAP = Math.PI / 12;

export function normalizeRotation(rotation: number) {
	const wrapped = rotation % (Math.PI * 2);
	if (wrapped > Math.PI) return wrapped - Math.PI * 2;
	if (wrapped <= -Math.PI) return wrapped + Math.PI * 2;
	return wrapped;
}

export function snapRotation(rotation: number, active: boolean) {
	return active
		? normalizeRotation(Math.round(rotation / ROTATION_SNAP) * ROTATION_SNAP)
		: rotation;
}

export function axisLockedDelta(delta: Point, active: boolean): Point {
	if (!active) return delta;
	return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
}

export function rotationLabel(rotation: number, locked: boolean): string {
	const degrees = (normalizeRotation(rotation) * 180) / Math.PI;
	const text = locked ? String(Math.round(degrees)) : degrees.toFixed(1);
	return `${text === '-0' || text === '-0.0' ? text.slice(1) : text}°`;
}

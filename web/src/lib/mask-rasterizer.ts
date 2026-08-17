import type { NormalizedPoint } from './edit-document.ts';

export interface MaskBrushStroke {
	points: NormalizedPoint[];
	size: number;
	feather: number;
	flow: number;
}

export interface LinearMaskGeometry {
	anchor: NormalizedPoint;
	rotation: number;
	compression: number;
}

export interface RadialMaskGeometry {
	center: NormalizedPoint;
	radiusX: number;
	radiusY: number;
	rotation: number;
	feather: number;
}

export const PAINT_RASTER_MAX_DIMENSION = 2048;

export function paintRasterDimensions(
	width: number,
	height: number,
	maxDimension = PAINT_RASTER_MAX_DIMENSION
): { width: number; height: number } {
	const scale = Math.min(1, maxDimension / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

export function rasterizeBrushStrokes(
	strokes: readonly MaskBrushStroke[],
	width: number,
	height: number
): Uint8Array {
	const alpha = emptyPlane(width, height);
	for (const stroke of strokes) rasterizeStrokeOnto(alpha, stroke, width, height);
	return alpha;
}

export function rasterizeLinearGradient(
	{ anchor, rotation, compression }: LinearMaskGeometry,
	width: number,
	height: number
): Uint8Array {
	const alpha = emptyPlane(width, height);
	const origin = toPixel(anchor, width, height);
	const direction = { x: Math.cos(rotation), y: Math.sin(rotation) };
	const band = 2 * compression * Math.max(width, height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const along = (x + 0.5 - origin.x) * direction.x + (y + 0.5 - origin.y) * direction.y;
			alpha[y * width + x] = Math.round(clamp01(0.5 + along / band) * 255);
		}
	}
	return alpha;
}

export function rasterizeRadialGradient(
	{ center, radiusX, radiusY, rotation, feather }: RadialMaskGeometry,
	width: number,
	height: number
): Uint8Array {
	const alpha = emptyPlane(width, height);
	const origin = toPixel(center, width, height);
	const maxDim = Math.max(width, height);
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const dx = x + 0.5 - origin.x;
			const dy = y + 0.5 - origin.y;
			const major = (dx * cos + dy * sin) / (radiusX * maxDim);
			const minor = (dy * cos - dx * sin) / (radiusY * maxDim);
			alpha[y * width + x] = Math.round(
				featheredCoverage(Math.hypot(major, minor), 1, feather) * 255
			);
		}
	}
	return alpha;
}

export interface PixelPoint {
	x: number;
	y: number;
}

export function rasterizeStrokeOnto(
	alpha: Uint8Array,
	stroke: MaskBrushStroke,
	width: number,
	height: number
): Uint8Array {
	const radius = (stroke.size / 2) * Math.max(width, height);
	for (const center of stampCenters(stroke.points, width, height, Math.max(1, radius / 2))) {
		stampCircle(alpha, center, radius, stroke.feather, stroke.flow, width, height);
	}
	return alpha;
}

export function stampCenters(
	points: readonly NormalizedPoint[],
	width: number,
	height: number,
	spacing: number
): PixelPoint[] {
	const [first, ...rest] = points.map((point) => toPixel(point, width, height));
	if (!first) return [];
	const stamps = [first];
	let previous = first;
	let sinceLast = 0;
	for (const point of rest) {
		const length = Math.hypot(point.x - previous.x, point.y - previous.y);
		let travelled = 0;
		while (length - travelled >= spacing - sinceLast) {
			travelled += spacing - sinceLast;
			sinceLast = 0;
			const t = travelled / length;
			stamps.push({
				x: previous.x + (point.x - previous.x) * t,
				y: previous.y + (point.y - previous.y) * t
			});
		}
		sinceLast += length - travelled;
		previous = point;
	}
	return stamps;
}

function stampCircle(
	alpha: Uint8Array,
	center: PixelPoint,
	radius: number,
	feather: number,
	flow: number,
	width: number,
	height: number
) {
	const left = Math.max(0, Math.floor(center.x - radius));
	const right = Math.min(width - 1, Math.ceil(center.x + radius));
	const top = Math.max(0, Math.floor(center.y - radius));
	const bottom = Math.min(height - 1, Math.ceil(center.y + radius));
	for (let y = top; y <= bottom; y += 1) {
		for (let x = left; x <= right; x += 1) {
			const distance = Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y);
			const coverage = featheredCoverage(distance, radius, feather);
			if (coverage === 0) continue;
			const index = y * width + x;
			alpha[index] = Math.min(255, alpha[index]! + Math.round(coverage * flow * 255));
		}
	}
}

function featheredCoverage(distance: number, radius: number, feather: number) {
	if (distance >= radius) return 0;
	const core = radius * (1 - feather);
	if (distance <= core) return 1;
	return (radius - distance) / (radius - core);
}

function emptyPlane(width: number, height: number) {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
		throw new Error('Mask dimensions must be positive integers');
	}
	return new Uint8Array(width * height);
}

function toPixel(point: NormalizedPoint, width: number, height: number): PixelPoint {
	return { x: point.x * width, y: point.y * height };
}

function clamp01(value: number) {
	return Math.min(1, Math.max(0, value));
}

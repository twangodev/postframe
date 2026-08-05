import {
	UNKNOWN_TRIMAP_VALUE,
	cropMaskRegion,
	matteBoundaryRadius,
	mergeRefinedAlpha,
	placeMaskRegion,
	prepareMatteRegion,
	type MaskBounds
} from './mask-refinement.ts';
import type { MaskEdgeStroke } from './smart-mask.ts';

const COLOR_SIGMA = 24;
const COLOR_WEIGHTS = gaussianWeights(3 * 255 * 255, COLOR_SIGMA);

interface ImagePixels {
	data: Uint8Array | Uint8ClampedArray;
	width: number;
	height: number;
	channels: number;
}

export function refineObjectMask(image: ImagePixels, coarseAlpha: Uint8Array) {
	validateImage(image);
	const radius = matteBoundaryRadius(image.width, image.height);
	const region = prepareMatteRegion(coarseAlpha, image.width, image.height, radius);
	if (!region) throw new Error('No object was found under the painted area');
	const coarse = cropMaskRegion(coarseAlpha, image.width, region.bounds);
	const refined = refineRgbBoundary(image, coarse, region.trimap, region.bounds, radius);
	const constrained = mergeRefinedAlpha(
		region.trimap,
		refined,
		region.bounds.width,
		region.bounds.height
	);
	return placeMaskRegion(constrained, region.bounds, image.width, image.height);
}

export function refineRgbBoundary(
	image: ImagePixels,
	coarseAlpha: Uint8Array,
	trimap: Uint8Array,
	bounds: MaskBounds,
	radius: number
) {
	validateImage(image);
	validateRegion(coarseAlpha, trimap, bounds, image.width, image.height, radius);
	const refined = coarseAlpha.slice();
	const diameter = radius * 2 + 1;
	const spatialWeights = gaussianKernel(radius, Math.max(1, radius * 0.6));

	for (let y = 0; y < bounds.height; y += 1) {
		for (let x = 0; x < bounds.width; x += 1) {
			const index = y * bounds.width + x;
			if (trimap[index] !== UNKNOWN_TRIMAP_VALUE) continue;
			const center = imageOffset(image, bounds.x + x, bounds.y + y);
			let weightedAlpha = 0;
			let totalWeight = 0;

			for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
				const neighborY = y + offsetY;
				if (neighborY < 0 || neighborY >= bounds.height) continue;
				for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
					const neighborX = x + offsetX;
					if (neighborX < 0 || neighborX >= bounds.width) continue;
					const neighbor = imageOffset(image, bounds.x + neighborX, bounds.y + neighborY);
					const colorWeight = COLOR_WEIGHTS[colorDistanceSquared(image, center, neighbor)]!;
					const spatialIndex = (offsetY + radius) * diameter + offsetX + radius;
					const weight = spatialWeights[spatialIndex]! * colorWeight;
					const neighborIndex = neighborY * bounds.width + neighborX;
					weightedAlpha += weight * constrainedAlpha(trimap, coarseAlpha, neighborIndex);
					totalWeight += weight;
				}
			}

			if (totalWeight > 0) refined[index] = Math.round(weightedAlpha / totalWeight);
		}
	}
	return refined;
}

export function refinePaintedMask(image: ImagePixels, alpha: Uint8Array, stroke: MaskEdgeStroke) {
	validateImage(image);
	if (alpha.length !== image.width * image.height) {
		throw new Error('Painted mask dimensions do not match the photo');
	}
	if (stroke.points.length === 0 || !Number.isFinite(stroke.radius) || stroke.radius <= 0) {
		throw new Error('Paint an edge before refining it');
	}
	const radius = matteBoundaryRadius(image.width, image.height);
	const brushRadius = Math.max(1, Math.round(stroke.radius * Math.max(image.width, image.height)));
	const points = stroke.points.map(({ x, y }) => ({ x: x * image.width, y: y * image.height }));
	const bounds = strokeBounds(points, brushRadius + radius, image.width, image.height);
	const coarse = cropMaskRegion(alpha, image.width, bounds);
	const trimap = Uint8Array.from(coarse, (value) =>
		value === UNKNOWN_TRIMAP_VALUE ? UNKNOWN_TRIMAP_VALUE - 1 : value
	);
	paintStroke(trimap, bounds, points, brushRadius);
	const refined = refineRgbBoundary(image, coarse, trimap, bounds, radius);
	return replaceMaskRegion(alpha, refined, bounds, image.width);
}

function constrainedAlpha(trimap: Uint8Array, alpha: Uint8Array, index: number) {
	if (trimap[index] === 0) return 0;
	if (trimap[index] === 255) return 255;
	return alpha[index]!;
}

function strokeBounds(
	points: { x: number; y: number }[],
	padding: number,
	width: number,
	height: number
): MaskBounds {
	let minimumX = points[0]!.x;
	let maximumX = minimumX;
	let minimumY = points[0]!.y;
	let maximumY = minimumY;
	for (const point of points.slice(1)) {
		minimumX = Math.min(minimumX, point.x);
		maximumX = Math.max(maximumX, point.x);
		minimumY = Math.min(minimumY, point.y);
		maximumY = Math.max(maximumY, point.y);
	}
	const left = Math.max(0, Math.floor(minimumX - padding));
	const top = Math.max(0, Math.floor(minimumY - padding));
	const right = Math.min(width, Math.ceil(maximumX + padding + 1));
	const bottom = Math.min(height, Math.ceil(maximumY + padding + 1));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function paintStroke(
	trimap: Uint8Array,
	bounds: MaskBounds,
	points: { x: number; y: number }[],
	radius: number
) {
	const segments = points.length === 1 ? [[points[0]!, points[0]!] as const] : pairwise(points);
	for (const [start, end] of segments) {
		const left = Math.max(bounds.x, Math.floor(Math.min(start.x, end.x) - radius));
		const top = Math.max(bounds.y, Math.floor(Math.min(start.y, end.y) - radius));
		const right = Math.min(
			bounds.x + bounds.width - 1,
			Math.ceil(Math.max(start.x, end.x) + radius)
		);
		const bottom = Math.min(
			bounds.y + bounds.height - 1,
			Math.ceil(Math.max(start.y, end.y) + radius)
		);
		for (let y = top; y <= bottom; y += 1) {
			for (let x = left; x <= right; x += 1) {
				if (pointSegmentDistanceSquared(x + 0.5, y + 0.5, start, end) > radius * radius) {
					continue;
				}
				trimap[(y - bounds.y) * bounds.width + x - bounds.x] = UNKNOWN_TRIMAP_VALUE;
			}
		}
	}
}

function pairwise<T>(values: T[]) {
	return values.slice(1).map((value, index) => [values[index]!, value] as const);
}

function pointSegmentDistanceSquared(
	x: number,
	y: number,
	start: { x: number; y: number },
	end: { x: number; y: number }
) {
	const deltaX = end.x - start.x;
	const deltaY = end.y - start.y;
	const lengthSquared = deltaX * deltaX + deltaY * deltaY;
	const position =
		lengthSquared === 0
			? 0
			: Math.max(0, Math.min(1, ((x - start.x) * deltaX + (y - start.y) * deltaY) / lengthSquared));
	const closestX = start.x + position * deltaX;
	const closestY = start.y + position * deltaY;
	return (x - closestX) ** 2 + (y - closestY) ** 2;
}

function replaceMaskRegion(
	alpha: Uint8Array,
	region: Uint8Array,
	bounds: MaskBounds,
	width: number
) {
	const replaced = alpha.slice();
	for (let y = 0; y < bounds.height; y += 1) {
		const source = y * bounds.width;
		const target = (bounds.y + y) * width + bounds.x;
		replaced.set(region.subarray(source, source + bounds.width), target);
	}
	return replaced;
}

function gaussianKernel(radius: number, sigma: number) {
	const diameter = radius * 2 + 1;
	const weights = new Float32Array(diameter * diameter);
	const denominator = 2 * sigma * sigma;
	for (let y = -radius; y <= radius; y += 1) {
		for (let x = -radius; x <= radius; x += 1) {
			weights[(y + radius) * diameter + x + radius] = Math.exp(-(x * x + y * y) / denominator);
		}
	}
	return weights;
}

function gaussianWeights(maximumDistance: number, sigma: number) {
	const weights = new Float32Array(maximumDistance + 1);
	const denominator = 2 * sigma * sigma;
	for (let distance = 0; distance <= maximumDistance; distance += 1) {
		weights[distance] = Math.exp(-distance / denominator);
	}
	return weights;
}

function imageOffset(image: ImagePixels, x: number, y: number) {
	return (y * image.width + x) * image.channels;
}

function colorDistanceSquared(image: ImagePixels, left: number, right: number) {
	let distance = 0;
	const channels = Math.min(3, image.channels);
	for (let channel = 0; channel < channels; channel += 1) {
		const difference = image.data[left + channel]! - image.data[right + channel]!;
		distance += difference * difference;
	}
	return distance;
}

function validateImage(image: ImagePixels) {
	if (
		!Number.isSafeInteger(image.width) ||
		!Number.isSafeInteger(image.height) ||
		!Number.isSafeInteger(image.channels) ||
		image.width < 1 ||
		image.height < 1 ||
		image.channels < 1 ||
		image.channels > 4 ||
		image.data.length !== image.width * image.height * image.channels
	) {
		throw new Error('Edge guidance dimensions do not match its pixels');
	}
}

function validateRegion(
	alpha: Uint8Array,
	trimap: Uint8Array,
	bounds: MaskBounds,
	width: number,
	height: number,
	radius: number
) {
	if (
		alpha.length !== bounds.width * bounds.height ||
		trimap.length !== alpha.length ||
		bounds.x < 0 ||
		bounds.y < 0 ||
		bounds.x + bounds.width > width ||
		bounds.y + bounds.height > height
	) {
		throw new Error('Edge refinement region does not match its pixels');
	}
	if (!Number.isSafeInteger(radius) || radius < 1)
		throw new Error('Edge refinement radius must be positive');
}

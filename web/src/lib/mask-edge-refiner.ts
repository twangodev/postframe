import {
	UNKNOWN_TRIMAP_VALUE,
	cropMaskRegion,
	matteBoundaryRadius,
	mergeRefinedAlpha,
	placeMaskRegion,
	prepareMatteRegion,
	type MaskBounds
} from './mask-refinement.ts';

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

function constrainedAlpha(trimap: Uint8Array, alpha: Uint8Array, index: number) {
	if (trimap[index] === 0) return 0;
	if (trimap[index] === 255) return 255;
	return alpha[index]!;
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

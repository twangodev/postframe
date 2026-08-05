import { RawImage } from '@huggingface/transformers';
import {
	cropMaskRegion,
	mergeRefinedAlpha,
	placeMaskRegion,
	prepareMatteRegion
} from './mask-refinement.ts';

const MAX_GUIDANCE_DIMENSION = 1536;
const GUIDED_FILTER_EPSILON = 0.0004;

export async function refineObjectMask(image: RawImage, coarseAlpha: Uint8Array) {
	const region = prepareMatteRegion(coarseAlpha, image.width, image.height);
	if (!region) throw new Error('No object was found under the painted area');
	const alphaCrop = cropMaskRegion(coarseAlpha, image.width, region.bounds);
	const imageCrop = await image
		.clone()
		.crop([
			region.bounds.x,
			region.bounds.y,
			region.bounds.x + region.bounds.width - 1,
			region.bounds.y + region.bounds.height - 1
		]);
	const input = await guidanceInput(imageCrop, alphaCrop);
	const radius = Math.max(4, Math.round(Math.max(input.width, input.height) / 128));
	let refined = guidedAlpha(
		Uint8Array.from(input.image.grayscale().data),
		Uint8Array.from(input.alpha.data),
		input.width,
		input.height,
		radius
	);
	if (input.width !== region.bounds.width || input.height !== region.bounds.height) {
		const resized = await new RawImage(refined, input.width, input.height, 1).resize(
			region.bounds.width,
			region.bounds.height
		);
		refined = Uint8Array.from(resized.data);
	}
	const constrained = mergeRefinedAlpha(
		region.trimap,
		refined,
		region.bounds.width,
		region.bounds.height
	);
	return placeMaskRegion(constrained, region.bounds, image.width, image.height);
}

export function guidedAlpha(
	guidance: Uint8Array,
	coarseAlpha: Uint8Array,
	width: number,
	height: number,
	radius: number,
	epsilon = GUIDED_FILTER_EPSILON
) {
	validateInput(guidance, coarseAlpha, width, height, radius, epsilon);
	const guide = Float32Array.from(guidance, (value) => value / 255);
	const alpha = Float32Array.from(coarseAlpha, (value) => value / 255);
	const meanGuide = new Float32Array(guide.length);
	const meanAlpha = new Float32Array(guide.length);
	const coefficient = new Float32Array(guide.length);
	const intercept = new Float32Array(guide.length);
	const scratch = new Float32Array(guide.length);

	boxMean(guide, meanGuide, scratch, width, height, radius);
	boxMean(alpha, meanAlpha, scratch, width, height, radius);
	for (let index = 0; index < guide.length; index += 1) {
		coefficient[index] = guide[index]! * guide[index]!;
		intercept[index] = guide[index]! * alpha[index]!;
	}
	boxMean(coefficient, coefficient, scratch, width, height, radius);
	boxMean(intercept, intercept, scratch, width, height, radius);
	for (let index = 0; index < guide.length; index += 1) {
		const variance = Math.max(0, coefficient[index]! - meanGuide[index]! * meanGuide[index]!);
		const covariance = intercept[index]! - meanGuide[index]! * meanAlpha[index]!;
		coefficient[index] = covariance / (variance + epsilon);
		intercept[index] = meanAlpha[index]! - coefficient[index]! * meanGuide[index]!;
	}
	boxMean(coefficient, meanGuide, scratch, width, height, radius);
	boxMean(intercept, meanAlpha, scratch, width, height, radius);
	return Uint8Array.from(guide, (value, index) =>
		Math.round(Math.max(0, Math.min(1, meanGuide[index]! * value + meanAlpha[index]!)) * 255)
	);
}

async function guidanceInput(image: RawImage, alpha: Uint8Array) {
	const scale = Math.min(1, MAX_GUIDANCE_DIMENSION / Math.max(image.width, image.height));
	const width = Math.max(1, Math.round(image.width * scale));
	const height = Math.max(1, Math.round(image.height * scale));
	let alphaImage = new RawImage(alpha, image.width, image.height, 1);
	if (scale === 1) return { image, alpha: alphaImage, width, height };
	const [resizedImage, resizedAlpha] = await Promise.all([
		image.resize(width, height),
		alphaImage.resize(width, height)
	]);
	alphaImage = resizedAlpha;
	return { image: resizedImage, alpha: alphaImage, width, height };
}

function boxMean(
	source: Float32Array,
	target: Float32Array,
	scratch: Float32Array,
	width: number,
	height: number,
	radius: number
) {
	for (let y = 0; y < height; y += 1) {
		const row = y * width;
		let sum = 0;
		for (let x = 0; x <= Math.min(radius, width - 1); x += 1) sum += source[row + x]!;
		for (let x = 0; x < width; x += 1) {
			const left = Math.max(0, x - radius);
			const right = Math.min(width - 1, x + radius);
			scratch[row + x] = sum / (right - left + 1);
			const removed = x - radius;
			const added = x + radius + 1;
			if (removed >= 0) sum -= source[row + removed]!;
			if (added < width) sum += source[row + added]!;
		}
	}
	for (let x = 0; x < width; x += 1) {
		let sum = 0;
		for (let y = 0; y <= Math.min(radius, height - 1); y += 1) sum += scratch[y * width + x]!;
		for (let y = 0; y < height; y += 1) {
			const top = Math.max(0, y - radius);
			const bottom = Math.min(height - 1, y + radius);
			target[y * width + x] = sum / (bottom - top + 1);
			const removed = y - radius;
			const added = y + radius + 1;
			if (removed >= 0) sum -= scratch[removed * width + x]!;
			if (added < height) sum += scratch[added * width + x]!;
		}
	}
}

function validateInput(
	guidance: Uint8Array,
	alpha: Uint8Array,
	width: number,
	height: number,
	radius: number,
	epsilon: number
) {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		guidance.length !== width * height ||
		alpha.length !== width * height
	) {
		throw new Error('Guided mask dimensions do not match its pixels');
	}
	if (!Number.isSafeInteger(radius) || radius < 1)
		throw new Error('Guided mask radius must be positive');
	if (!Number.isFinite(epsilon) || epsilon <= 0)
		throw new Error('Guided mask epsilon must be positive');
}

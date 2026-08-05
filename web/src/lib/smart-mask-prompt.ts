import type { NormalizedPoint } from './edit-document.ts';
import type { SmartMaskStroke } from './smart-mask.ts';

const MODEL_POINTS_PER_STROKE = 4;
const MODEL_POINTS_PER_LABEL = 8;
const MODEL_PROPOSALS = 4;
const MASK_THRESHOLD = 0;

export interface SmartMaskModelPoint {
	label: SmartMaskStroke['label'];
	point: NormalizedPoint;
}

export interface SmartMaskModelProposal {
	inputPoints: [number, number][];
	inputLabels: number[];
}

export interface SmartMaskModelPrompt {
	points: SmartMaskModelPoint[];
	proposals: SmartMaskModelProposal[];
}

export interface PromptedMaskSelection {
	index: number;
	width: number;
	height: number;
	alpha: Uint8Array;
	score: number;
}

interface CandidateMask {
	index: number;
	alpha: Uint8Array;
	score: number;
	positiveCoverage: number;
}

export function prepareSmartMaskPrompt(
	strokes: SmartMaskStroke[],
	width: number,
	height: number
): SmartMaskModelPrompt {
	const points = [
		...representativePoints(strokes, 'foreground'),
		...representativePoints(strokes, 'background')
	];
	if (!points.some(({ label }) => label === 'foreground')) {
		throw new Error('Paint over an object before selecting it');
	}
	const foreground = points.filter(({ label }) => label === 'foreground');
	const background = points.filter(({ label }) => label === 'background');
	return {
		points,
		proposals: sampleEvenly(foreground, MODEL_PROPOSALS).map((seed) => ({
			inputPoints: [seed, ...background].map(({ point }) => imagePoint(point, width, height)),
			inputLabels: [1, ...background.map(() => 0)]
		}))
	};
}

export function selectPromptedMask(
	data: ArrayLike<number>,
	dimensions: readonly number[],
	scores: ArrayLike<number>,
	prompt: SmartMaskModelPrompt
): PromptedMaskSelection | null {
	const width = dimensions.at(-1) ?? 0;
	const height = dimensions.at(-2) ?? 0;
	const size = width * height;
	const candidateCount = size > 0 ? Math.min(scores.length, Math.floor(data.length / size)) : 0;
	if (width < 1 || height < 1 || candidateCount < 1 || data.length < size * candidateCount) {
		throw new Error('The object model returned invalid masks');
	}

	let selected: CandidateMask | null = null;
	for (let index = 0; index < candidateCount; index += 1) {
		const candidate = promptedComponents(data, index * size, width, height, prompt.points);
		const modelScore = Number(scores[index] ?? 0);
		const negativeAccuracy = candidate.negativeCount
			? 1 - candidate.negativeHits / candidate.negativeCount
			: 0;
		const areaPenalty = Math.sqrt(candidate.area / size);
		const score =
			candidate.positiveCoverage * 4 + negativeAccuracy * 2 + modelScore - areaPenalty * 0.25;
		if (!selected || score > selected.score) {
			selected = {
				index,
				alpha: candidate.alpha,
				score,
				positiveCoverage: candidate.positiveCoverage
			};
		}
	}

	return selected && selected.positiveCoverage > 0
		? { index: selected.index, width, height, alpha: selected.alpha, score: selected.score }
		: null;
}

export function selectedMaskInput(
	data: ArrayLike<number>,
	dimensions: readonly number[],
	index: number
) {
	const width = dimensions.at(-1) ?? 0;
	const height = dimensions.at(-2) ?? 0;
	const size = width * height;
	const start = index * size;
	if (width < 1 || height < 1 || start + size > data.length) {
		throw new Error('The object model returned invalid mask logits');
	}
	return {
		data: Float32Array.from({ length: size }, (_, offset) => Number(data[start + offset])),
		dimensions: [1, 1, height, width] as [number, number, number, number]
	};
}

function representativePoints(strokes: SmartMaskStroke[], label: SmartMaskStroke['label']) {
	const sampled = strokes
		.filter((stroke) => stroke.label === label)
		.flatMap((stroke) => sampleEvenly(stroke.points, MODEL_POINTS_PER_STROKE))
		.map((point) => ({ label, point }));
	return sampleEvenly(uniquePoints(sampled), MODEL_POINTS_PER_LABEL);
}

function sampleEvenly<Value>(values: Value[], limit: number) {
	if (values.length <= limit) return values;
	return Array.from(
		{ length: limit },
		(_, index) => values[Math.floor(((index + 0.5) * values.length) / limit)]!
	);
}

function uniquePoints(points: SmartMaskModelPoint[]) {
	const seen = new Set<string>();
	return points.filter(({ label, point }) => {
		const key = `${label}:${point.x}:${point.y}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function promptedComponents(
	data: ArrayLike<number>,
	offset: number,
	width: number,
	height: number,
	points: SmartMaskModelPoint[]
) {
	const size = width * height;
	const alpha = new Uint8Array(size);
	const visited = new Uint8Array(size);
	const queue = new Int32Array(size);
	const foreground = points.filter(({ label }) => label === 'foreground');
	const background = points.filter(({ label }) => label === 'background');
	let positiveHits = 0;
	let area = 0;

	for (const { point } of foreground) {
		const seed = nearestMaskPixel(data, offset, width, height, point);
		if (seed === null) continue;
		positiveHits += 1;
		if (visited[seed]) continue;
		area += fillComponent(data, offset, width, height, seed, visited, alpha, queue);
	}

	const negativeHits = background.filter(
		({ point }) => alpha[pixelIndex(point, width, height)]
	).length;
	return {
		alpha,
		area,
		positiveCoverage: positiveHits / foreground.length,
		negativeHits,
		negativeCount: background.length
	};
}

function fillComponent(
	data: ArrayLike<number>,
	offset: number,
	width: number,
	height: number,
	seed: number,
	visited: Uint8Array,
	alpha: Uint8Array,
	queue: Int32Array
) {
	let head = 0;
	let tail = 1;
	let area = 0;
	queue[0] = seed;
	visited[seed] = 1;

	while (head < tail) {
		const index = queue[head++]!;
		alpha[index] = 255;
		area += 1;
		const x = index % width;
		const y = Math.floor(index / width);
		for (let vertical = -1; vertical <= 1; vertical += 1) {
			for (let horizontal = -1; horizontal <= 1; horizontal += 1) {
				if (horizontal === 0 && vertical === 0) continue;
				const nextX = x + horizontal;
				const nextY = y + vertical;
				if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
				const next = nextY * width + nextX;
				if (visited[next] || Number(data[offset + next]) <= MASK_THRESHOLD) continue;
				visited[next] = 1;
				queue[tail++] = next;
			}
		}
	}
	return area;
}

function nearestMaskPixel(
	data: ArrayLike<number>,
	offset: number,
	width: number,
	height: number,
	point: NormalizedPoint
) {
	const center = pixelCoordinates(point, width, height);
	for (let radius = 0; radius <= 3; radius += 1) {
		for (
			let y = Math.max(0, center.y - radius);
			y <= Math.min(height - 1, center.y + radius);
			y += 1
		) {
			for (
				let x = Math.max(0, center.x - radius);
				x <= Math.min(width - 1, center.x + radius);
				x += 1
			) {
				if (Number(data[offset + y * width + x]) > MASK_THRESHOLD) return y * width + x;
			}
		}
	}
	return null;
}

function pixelIndex(point: NormalizedPoint, width: number, height: number) {
	const { x, y } = pixelCoordinates(point, width, height);
	return y * width + x;
}

function pixelCoordinates(point: NormalizedPoint, width: number, height: number) {
	return {
		x: Math.min(width - 1, Math.max(0, Math.round(point.x * (width - 1)))),
		y: Math.min(height - 1, Math.max(0, Math.round(point.y * (height - 1))))
	};
}

function imagePoint(point: NormalizedPoint, width: number, height: number): [number, number] {
	return [point.x * Math.max(0, width - 1), point.y * Math.max(0, height - 1)];
}

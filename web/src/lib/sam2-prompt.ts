import type { NormalizedPoint, NormalizedRegion } from './edit-document.ts';
import type { SmartMaskStroke } from './smart-mask.ts';

const MAX_PROMPT_POINTS = 16;
const MAX_POINTS_PER_STROKE = 5;
const PROMPT_SPACING_PIXELS = 96;

export interface Sam2PromptPoint extends NormalizedPoint {
	label: 0 | 1;
}

export interface Sam2PointPrompt {
	points: Sam2PromptPoint[];
	coordinates: [number, number][][][];
	labels: (0 | 1)[][][];
}

export interface Sam2BoxPrompt {
	center: Sam2PromptPoint;
	coordinates: [number, number, number, number][][];
}

export function createSam2BoxPrompt(
	box: NormalizedRegion,
	imageWidth: number,
	imageHeight: number
): Sam2BoxPrompt {
	const scaleX = Math.max(0, imageWidth - 1);
	const scaleY = Math.max(0, imageHeight - 1);
	return {
		center: { x: box.x + box.width / 2, y: box.y + box.height / 2, label: 1 },
		coordinates: [
			[
				[
					box.x * scaleX,
					box.y * scaleY,
					(box.x + box.width) * scaleX,
					(box.y + box.height) * scaleY
				]
			]
		]
	};
}

export function fitSam2PromptToPaddedImage(
	points: Sam2PromptPoint[],
	reshapedSize: [number, number],
	paddedSize: [number, number]
) {
	const [reshapedHeight, reshapedWidth] = reshapedSize;
	const [paddedHeight, paddedWidth] = paddedSize;
	return points.map((point) => ({
		...point,
		x: point.x * (reshapedWidth / paddedWidth),
		y: point.y * (reshapedHeight / paddedHeight)
	}));
}

export function createSam2PointPrompt(
	strokes: SmartMaskStroke[],
	imageWidth: number,
	imageHeight: number
): Sam2PointPrompt {
	if (!strokes.some(({ label }) => label === 'foreground')) {
		throw new Error('Paint over the object before subtracting from it');
	}

	const sampled = strokes.flatMap((stroke) =>
		sampleStroke(stroke.points, imageWidth, imageHeight).map((point) => ({
			...point,
			label: stroke.label === 'foreground' ? (1 as const) : (0 as const)
		}))
	);
	const points = fitPromptBudget(sampled);
	return {
		points,
		coordinates: [
			[
				points.map(({ x, y }) => [
					x * Math.max(0, imageWidth - 1),
					y * Math.max(0, imageHeight - 1)
				])
			]
		],
		labels: [[points.map(({ label }) => label)]]
	};
}

function sampleStroke(points: NormalizedPoint[], imageWidth: number, imageHeight: number) {
	const first = points[0];
	if (!first || points.length === 1) return first ? [first] : [];

	const segments = points.slice(1).map((point, index) => {
		const start = points[index]!;
		return {
			start,
			end: point,
			length: Math.hypot((point.x - start.x) * imageWidth, (point.y - start.y) * imageHeight)
		};
	});
	const length = segments.reduce((total, segment) => total + segment.length, 0);
	const count = Math.min(
		MAX_POINTS_PER_STROKE,
		Math.max(2, Math.ceil(length / PROMPT_SPACING_PIXELS) + 1)
	);
	return Array.from({ length: count }, (_, index) =>
		pointAlongStroke(segments, length * (index / (count - 1)))
	);
}

function pointAlongStroke(
	segments: { start: NormalizedPoint; end: NormalizedPoint; length: number }[],
	distance: number
) {
	let remaining = distance;
	for (const segment of segments) {
		if (remaining <= segment.length || segment === segments.at(-1)) {
			const progress = segment.length === 0 ? 0 : Math.min(1, remaining / segment.length);
			return {
				x: segment.start.x + (segment.end.x - segment.start.x) * progress,
				y: segment.start.y + (segment.end.y - segment.start.y) * progress
			};
		}
		remaining -= segment.length;
	}
	return segments.at(-1)!.end;
}

function fitPromptBudget(points: Sam2PromptPoint[]) {
	if (points.length <= MAX_PROMPT_POINTS) return points;
	const selected = evenlySpaced(points, MAX_PROMPT_POINTS);
	if (selected.some(({ label }) => label === 1)) return selected;
	const foreground = points.find(({ label }) => label === 1)!;
	return [foreground, ...selected.slice(1)];
}

function evenlySpaced<T>(values: T[], count: number) {
	return Array.from(
		{ length: count },
		(_, index) => values[Math.round(index * ((values.length - 1) / (count - 1)))]!
	);
}

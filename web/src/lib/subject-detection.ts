import type { NormalizedRegion } from './edit-document.ts';

export interface RawDetection {
	label: string;
	score: number;
	box: { xmin: number; ymin: number; xmax: number; ymax: number };
}

export interface DetectedSubject {
	label: string;
	score: number;
	box: NormalizedRegion;
}

const SUBJECT_LABELS = new Set([
	'person',
	'cat',
	'dog',
	'bird',
	'horse',
	'sheep',
	'cow',
	'elephant',
	'bear',
	'zebra',
	'giraffe'
]);
const MINIMUM_SCORE = 0.5;
const MAXIMUM_SUBJECTS = 8;
const DUPLICATE_OVERLAP = 0.7;

export function detectedSubjects(
	detections: RawDetection[],
	imageWidth: number,
	imageHeight: number
): DetectedSubject[] {
	const candidates = detections
		.filter(({ label, score }) => SUBJECT_LABELS.has(label) && score >= MINIMUM_SCORE)
		.map(({ label, score, box }) => ({
			label,
			score,
			box: normalizedBox(box, imageWidth, imageHeight)
		}))
		.filter(({ box }) => box.width > 0 && box.height > 0)
		.sort((left, right) => right.score - left.score);

	const distinct: DetectedSubject[] = [];
	for (const candidate of candidates) {
		if (distinct.every(({ box }) => overlap(box, candidate.box) < DUPLICATE_OVERLAP)) {
			distinct.push(candidate);
		}
	}
	return distinct
		.slice(0, MAXIMUM_SUBJECTS)
		.sort((left, right) => centerX(left.box) - centerX(right.box));
}

export function detectedSubjectName(subjects: DetectedSubject[], index: number) {
	const subject = subjects[index];
	if (!subject) return 'subject';
	const peers = subjects.filter(({ label }) => label === subject.label);
	return peers.length === 1 ? subject.label : `${subject.label} ${peers.indexOf(subject) + 1}`;
}

function normalizedBox(
	box: RawDetection['box'],
	imageWidth: number,
	imageHeight: number
): NormalizedRegion {
	const left = clampUnit(box.xmin / imageWidth);
	const top = clampUnit(box.ymin / imageHeight);
	return {
		x: left,
		y: top,
		width: clampUnit(box.xmax / imageWidth) - left,
		height: clampUnit(box.ymax / imageHeight) - top
	};
}

function overlap(left: NormalizedRegion, right: NormalizedRegion) {
	const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
	const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
	if (width <= 0 || height <= 0) return 0;
	const intersection = width * height;
	return intersection / (left.width * left.height + right.width * right.height - intersection);
}

function centerX(box: NormalizedRegion) {
	return box.x + box.width / 2;
}

function clampUnit(value: number) {
	return Math.min(1, Math.max(0, value));
}

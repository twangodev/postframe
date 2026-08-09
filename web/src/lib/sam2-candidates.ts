import type { Sam2PromptPoint } from './sam2-prompt.ts';

export interface Sam2MaskCandidate {
	width: number;
	height: number;
	logits: Float32Array;
	predictedIou: number;
	objectScore: number;
}

export interface RankedSam2MaskCandidate extends Sam2MaskCandidate {
	index: number;
	score: number;
}

export function rankSam2MaskCandidates(
	candidates: Sam2MaskCandidate[],
	prompts: Sam2PromptPoint[]
) {
	return candidates
		.map((candidate, index) => ({
			...candidate,
			index,
			score: candidateScore(candidate, prompts)
		}))
		.sort((left, right) => right.score - left.score);
}

export function usableSam2Mask(candidate: Sam2MaskCandidate, prompts: Sam2PromptPoint[]) {
	if (
		candidate.width < 1 ||
		candidate.height < 1 ||
		candidate.logits.length !== candidate.width * candidate.height ||
		!Number.isFinite(candidate.predictedIou) ||
		!Number.isFinite(candidate.objectScore)
	) {
		return false;
	}

	let selected = 0;
	for (const logit of candidate.logits) {
		if (!Number.isFinite(logit)) return false;
		if (logit > 0) selected += 1;
	}
	const positivePrompts = prompts.filter(({ label }) => label === 1);
	const selectedFraction = selected / candidate.logits.length;
	return (
		selected >= Math.max(8, positivePrompts.length * 4) &&
		selectedFraction < 0.98 &&
		promptAgreement(candidate, positivePrompts) >= 0.5 &&
		promptAgreement(
			candidate,
			prompts.filter(({ label }) => label === 0)
		) >= 0.5
	);
}

function candidateScore(candidate: Sam2MaskCandidate, prompts: Sam2PromptPoint[]) {
	return (
		candidate.predictedIou * 0.5 +
		sigmoid(candidate.objectScore) * 0.15 +
		promptAgreement(candidate, prompts) * 0.25 +
		stability(candidate.logits) * 0.1
	);
}

function promptAgreement(candidate: Sam2MaskCandidate, prompts: Sam2PromptPoint[]) {
	if (prompts.length === 0) return 1;
	return (
		prompts.reduce((total, prompt) => {
			const probability = sigmoid(logitAt(candidate, prompt));
			return total + (prompt.label === 1 ? probability : 1 - probability);
		}, 0) / prompts.length
	);
}

function logitAt(candidate: Sam2MaskCandidate, point: Sam2PromptPoint) {
	const x = Math.round(point.x * (candidate.width - 1));
	const y = Math.round(point.y * (candidate.height - 1));
	return candidate.logits[y * candidate.width + x]!;
}

function stability(logits: Float32Array) {
	let intersection = 0;
	let union = 0;
	for (const logit of logits) {
		if (logit > 0.5) intersection += 1;
		if (logit > -0.5) union += 1;
	}
	return union === 0 ? 0 : intersection / union;
}

function sigmoid(value: number) {
	return 1 / (1 + Math.exp(-value));
}

import type { SmartMaskStroke } from './smart-mask.ts';

const PROMPT_CHANNELS = 3;
const PREVIOUS_MASK_CHANNEL = 0;
const FOREGROUND_CHANNEL = 1;
const BACKGROUND_CHANNEL = 2;

export function createSegNextPrompt(
	strokes: SmartMaskStroke[],
	size: number,
	previousMask?: Float32Array
) {
	if (!strokes.some(({ label }) => label === 'foreground')) {
		throw new Error('Paint over an object before selecting it');
	}

	const channelSize = size * size;
	const prompt = new Float32Array(PROMPT_CHANNELS * channelSize);
	if (previousMask) {
		if (previousMask.length !== channelSize) throw new Error('The previous object mask is invalid');
		prompt.set(previousMask, PREVIOUS_MASK_CHANNEL * channelSize);
	}

	for (const stroke of strokes) {
		const channel = stroke.label === 'foreground' ? FOREGROUND_CHANNEL : BACKGROUND_CHANNEL;
		drawStroke(prompt, channel * channelSize, size, stroke.points);
	}
	return prompt;
}

function drawStroke(
	prompt: Float32Array,
	offset: number,
	size: number,
	points: SmartMaskStroke['points']
) {
	const radius = Math.max(1, Math.round(size / 205));
	const pixels = points.map(({ x, y }) => ({
		x: Math.round(x * (size - 1)),
		y: Math.round(y * (size - 1))
	}));
	const first = pixels[0];
	if (!first) return;
	drawDisk(prompt, offset, size, first.x, first.y, radius);
	for (let index = 1; index < pixels.length; index += 1) {
		drawLine(prompt, offset, size, pixels[index - 1]!, pixels[index]!, radius);
	}
}

function drawLine(
	prompt: Float32Array,
	offset: number,
	size: number,
	start: { x: number; y: number },
	end: { x: number; y: number },
	radius: number
) {
	const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
	if (steps === 0) {
		drawDisk(prompt, offset, size, start.x, start.y, radius);
		return;
	}
	for (let step = 1; step <= steps; step += 1) {
		const progress = step / steps;
		drawDisk(
			prompt,
			offset,
			size,
			Math.round(start.x + (end.x - start.x) * progress),
			Math.round(start.y + (end.y - start.y) * progress),
			radius
		);
	}
}

function drawDisk(
	prompt: Float32Array,
	offset: number,
	size: number,
	centerX: number,
	centerY: number,
	radius: number
) {
	const radiusSquared = radius * radius;
	for (let y = Math.max(0, centerY - radius); y <= Math.min(size - 1, centerY + radius); y += 1) {
		for (let x = Math.max(0, centerX - radius); x <= Math.min(size - 1, centerX + radius); x += 1) {
			if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radiusSquared) {
				prompt[offset + y * size + x] = 1;
			}
		}
	}
}

import { lightSettingsSchema, type LightSettings } from './develop-settings.ts';
import { sampleDisc } from './white-balance.ts';
import type { ActiveDocument } from './worker-documents.ts';
import type { WhiteBalanceSample } from './worker-protocol.ts';
import { sourceImage } from './worker-render.ts';
import { wasm } from './worker-wasm.ts';

const ANALYSIS_DIMENSION = 1024;

export async function autoBalance(active: ActiveDocument, sample?: WhiteBalanceSample) {
	const source = await sourceImage(active, ANALYSIS_DIMENSION);
	const [temperature = 0, tint = 0] = sample
		? sampledBalance(source, sample)
		: wasm.auto_white_balance(pixels(source), source.width, source.height);
	return { temperature, tint };
}

export async function autoTone(active: ActiveDocument): Promise<LightSettings> {
	const source = await sourceImage(active, ANALYSIS_DIMENSION);
	return lightSettingsSchema.parse(wasm.auto_tone(pixels(source), source.width, source.height));
}

function sampledBalance(source: ImageData, sample: WhiteBalanceSample) {
	const [red, green, blue] = sampleDisc(
		{ width: source.width, height: source.height, rgba: source.data },
		sample,
		sample.radius
	);
	const balance = wasm.neutralizing_balance(red, green, blue);
	if (!balance) throw new Error('Pick a point with some colour to balance');
	return balance;
}

function pixels(source: ImageData) {
	return new Uint8Array(source.data.buffer, source.data.byteOffset, source.data.byteLength);
}

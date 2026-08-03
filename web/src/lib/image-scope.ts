export const HISTOGRAM_BINS = 256;
export const HISTOGRAM_CHANNELS = 4;
export const WAVEFORM_CHANNELS = 3;
export const WAVEFORM_WIDTH = 512;
export const WAVEFORM_HEIGHT = 256;

const SAMPLE_TARGET = 750_000;

export interface ImageScopeTransfer {
	histogram: ArrayBuffer;
	waveform: ArrayBuffer;
	waveformWidth: number;
	waveformHeight: number;
	sampleCount: number;
}

export interface ImageScopeData {
	histogram: Uint32Array;
	waveform: Uint16Array;
	waveformWidth: number;
	waveformHeight: number;
	sampleCount: number;
}

export type ImageScopeMode = 'waveform' | 'histogram';

export function imageScopeFromTransfer(scope: ImageScopeTransfer): ImageScopeData {
	const histogram = new Uint32Array(scope.histogram);
	const waveform = new Uint16Array(scope.waveform);
	if (histogram.length !== HISTOGRAM_CHANNELS * HISTOGRAM_BINS) {
		throw new Error('Scope histogram has an unexpected size');
	}
	if (
		scope.waveformWidth <= 0 ||
		scope.waveformHeight <= 0 ||
		waveform.length !== WAVEFORM_CHANNELS * scope.waveformWidth * scope.waveformHeight
	) {
		throw new Error('Scope waveform has an unexpected size');
	}
	return {
		histogram,
		waveform,
		waveformWidth: scope.waveformWidth,
		waveformHeight: scope.waveformHeight,
		sampleCount: scope.sampleCount
	};
}

export function imageScopeFromRgba(rgba: Uint8ClampedArray, width: number, height: number) {
	if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
		throw new Error('Scope pixel buffer has an unexpected size');
	}
	const pixelCount = width * height;
	const stride = Math.max(1, Math.ceil(Math.sqrt(pixelCount / SAMPLE_TARGET)));
	const histogram = new Uint32Array(HISTOGRAM_CHANNELS * HISTOGRAM_BINS);
	const waveform = new Uint16Array(WAVEFORM_CHANNELS * WAVEFORM_WIDTH * WAVEFORM_HEIGHT);
	let sampleCount = 0;

	for (let y = 0; y < height; y += stride) {
		for (let x = 0; x < width; x += stride) {
			const offset = (y * width + x) * 4;
			if ((rgba[offset + 3] ?? 0) === 0) continue;
			const red = rgba[offset] ?? 0;
			const green = rgba[offset + 1] ?? 0;
			const blue = rgba[offset + 2] ?? 0;
			const luma = (54 * red + 183 * green + 19 * blue) >> 8;
			const scopeX = Math.floor((x * WAVEFORM_WIDTH) / width);

			for (const [channel, value] of [red, green, blue, luma].entries()) {
				histogram[channel * HISTOGRAM_BINS + value] += 1;
			}

			for (const [channel, value] of [red, green, blue].entries()) {
				const scopeY =
					WAVEFORM_HEIGHT - 1 - Math.floor((value * (WAVEFORM_HEIGHT - 1)) / (HISTOGRAM_BINS - 1));
				const index = channel * WAVEFORM_WIDTH * WAVEFORM_HEIGHT + scopeY * WAVEFORM_WIDTH + scopeX;
				waveform[index] = Math.min(65_535, waveform[index] + 1);
			}
			sampleCount += 1;
		}
	}

	return {
		histogram,
		waveform,
		waveformWidth: WAVEFORM_WIDTH,
		waveformHeight: WAVEFORM_HEIGHT,
		sampleCount
	} satisfies ImageScopeData;
}

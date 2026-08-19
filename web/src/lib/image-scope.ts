export const HISTOGRAM_BINS = 256;
export const HISTOGRAM_CHANNELS = 4;
export const HISTOGRAM_CHANNEL = { red: 0, green: 1, blue: 2, luma: 3 } as const;
export type HistogramChannel = keyof typeof HISTOGRAM_CHANNEL;
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

/**
 * Bin counts as [0, 1] heights, scaled from the interior peak (edge bins hold
 * clipped tones and would dwarf everything) with a sqrt to keep quiet tones visible.
 */
export function histogramProfile(histogram: Uint32Array, channel: HistogramChannel) {
	const base = HISTOGRAM_CHANNEL[channel] * HISTOGRAM_BINS;
	const bins = histogram.subarray(base, base + HISTOGRAM_BINS);
	const interior = bins.subarray(1, HISTOGRAM_BINS - 1);
	const peak = interior.reduce((tallest, count) => Math.max(tallest, count), 0);
	if (peak === 0) return Array.from(bins, () => 0);
	return Array.from(bins, (count) => Math.min(1, Math.sqrt(count / peak)));
}

export interface HistogramPoint {
	bin: number;
	red: number;
	green: number;
	blue: number;
	luma: number;
}

/** Bins scaled against the tallest bin on a log curve — distinct from histogramProfile's interior-peak scaling. */
export function histogramPoints(histogram: Uint32Array): HistogramPoint[] {
	let peak = 1;
	for (const count of histogram) peak = Math.max(peak, count);
	const logarithmicPeak = Math.log1p(peak);
	const level = (channel: HistogramChannel, bin: number) =>
		Math.log1p(histogram[HISTOGRAM_CHANNEL[channel] * HISTOGRAM_BINS + bin] ?? 0) / logarithmicPeak;

	return Array.from({ length: HISTOGRAM_BINS }, (_, bin) => ({
		bin,
		red: level('red', bin),
		green: level('green', bin),
		blue: level('blue', bin),
		luma: level('luma', bin)
	}));
}

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

export function imageScopeFromRgba(
	rgba: Uint8ClampedArray,
	width: number,
	height: number,
	sampleTarget = SAMPLE_TARGET
) {
	if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
		throw new Error('Scope pixel buffer has an unexpected size');
	}
	const pixelCount = width * height;
	const stride = Math.max(1, Math.ceil(Math.sqrt(pixelCount / Math.max(1, sampleTarget))));
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

			histogram[HISTOGRAM_CHANNEL.red * HISTOGRAM_BINS + red] += 1;
			histogram[HISTOGRAM_CHANNEL.green * HISTOGRAM_BINS + green] += 1;
			histogram[HISTOGRAM_CHANNEL.blue * HISTOGRAM_BINS + blue] += 1;
			histogram[HISTOGRAM_CHANNEL.luma * HISTOGRAM_BINS + luma] += 1;

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

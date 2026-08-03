export const HISTOGRAM_BINS = 256;
export const SCOPE_CHANNELS = 4;

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
	if (histogram.length !== SCOPE_CHANNELS * HISTOGRAM_BINS) {
		throw new Error('Scope histogram has an unexpected size');
	}
	if (
		scope.waveformWidth <= 0 ||
		scope.waveformHeight <= 0 ||
		waveform.length !== SCOPE_CHANNELS * scope.waveformWidth * scope.waveformHeight
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

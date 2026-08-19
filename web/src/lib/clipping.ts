import { HISTOGRAM_BINS, HISTOGRAM_CHANNEL } from './image-scope.ts';

export const CLIPPING_KINDS = ['shadows', 'highlights'] as const;
export type ClippingKind = (typeof CLIPPING_KINDS)[number];
export type ClippingIndicators = Record<ClippingKind, boolean>;

export const HIGHLIGHT_CLIPPING_COLOR = [255, 32, 32] as const;
export const SHADOW_CLIPPING_COLOR = [32, 96, 255] as const;

export function noClipping(): ClippingIndicators {
	return { highlights: false, shadows: false };
}

export function showsClipping(indicators: ClippingIndicators) {
	return indicators.highlights || indicators.shadows;
}

/** Marks clipped pixels in place: any channel at 255 turns highlight red, at 0 turns shadow blue, highlights win ties. */
export function paintClipping(
	rgba: Uint8Array | Uint8ClampedArray,
	indicators: ClippingIndicators
) {
	if (!showsClipping(indicators)) return;
	for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
		const red = rgba[offset] ?? 0;
		const green = rgba[offset + 1] ?? 0;
		const blue = rgba[offset + 2] ?? 0;
		if (indicators.highlights && (red === 255 || green === 255 || blue === 255)) {
			rgba.set(HIGHLIGHT_CLIPPING_COLOR, offset);
		} else if (indicators.shadows && (red === 0 || green === 0 || blue === 0)) {
			rgba.set(SHADOW_CLIPPING_COLOR, offset);
		}
	}
}

/** Which ends of the RGB histogram hold clipped pixels in any channel. */
export function clippedEnds(histogram: Uint32Array): ClippingIndicators {
	const ends = noClipping();
	for (const channel of ['red', 'green', 'blue'] as const) {
		const base = HISTOGRAM_CHANNEL[channel] * HISTOGRAM_BINS;
		if ((histogram[base] ?? 0) > 0) ends.shadows = true;
		if ((histogram[base + HISTOGRAM_BINS - 1] ?? 0) > 0) ends.highlights = true;
	}
	return ends;
}

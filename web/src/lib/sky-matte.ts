export interface SkySegment {
	label: string | null;
	mask: { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
}

// LABEL_187 is COCO panoptic's sky-other-merged; the checkpoint's id2label predates
// the merged stuff categories, so the model reports sky through the placeholder name.
const SKY_SEGMENT_LABELS = new Set(['sky-other', 'clouds', 'LABEL_187']);

export function skySegmentAlpha(
	segments: readonly SkySegment[],
	width: number,
	height: number
): Uint8Array | null {
	const sky = segments.filter(({ label }) => label !== null && SKY_SEGMENT_LABELS.has(label));
	if (sky.length === 0) return null;

	const alpha = new Uint8Array(width * height);
	for (const { mask } of sky) {
		if (mask.width !== width || mask.height !== height || mask.data.length !== alpha.length) {
			throw new Error('Sky segment does not match the photo dimensions');
		}
		for (let index = 0; index < alpha.length; index += 1) {
			if (mask.data[index]) alpha[index] = 255;
		}
	}
	return alpha;
}

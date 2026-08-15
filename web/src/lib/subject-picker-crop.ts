import type { NormalizedRegion } from './edit-document.ts';

export interface CoverCrop {
	size: string;
	position: string;
}

export function coverCrop(box: NormalizedRegion, chipAspect: number, imageAspect = 1): CoverCrop {
	const boxAspect = (box.width / box.height) * imageAspect;
	const fillsWidth = boxAspect <= chipAspect;
	const scaleX = fillsWidth ? 1 / box.width : imageAspect / (box.height * chipAspect);
	const scaleY = fillsWidth ? chipAspect / (box.width * imageAspect) : 1 / box.height;
	return {
		size: `${percentage(100 * scaleX)} ${percentage(100 * scaleY)}`,
		position:
			`${percentage(axisPosition(box.x + box.width / 2, scaleX))} ` +
			`${percentage(axisPosition(box.y + box.height / 2, scaleY))}`
	};
}

function axisPosition(center: number, scale: number) {
	if (scale === 1) return 50;
	const centered = (100 * (0.5 - center * scale)) / (1 - scale);
	return Math.min(100, Math.max(0, centered));
}

function percentage(value: number) {
	return `${Math.round(value * 10000) / 10000}%`;
}

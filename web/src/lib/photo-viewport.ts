export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface ViewportTransform {
	scale: number;
	pan: Point;
}

export const MAX_ZOOM_SCALE = 32;
export const MIN_ZOOM_SCALE = 0.05;
export const VIEWPORT_INSET = 24;
export const PAN_OVERSCROLL = 48;
export const ZOOM_PRESETS = [
	0.05, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 4, 8, 16, 32
] as const;
export const ZOOM_MENU_PRESETS = [0.05, 0.1, 0.25, 0.5, 2, 4, 8, 16, 32] as const;

export function fitScale(viewport: Size, image: Size, inset = VIEWPORT_INSET) {
	if (!validSize(viewport) || !validSize(image)) return 1;
	const availableWidth = Math.max(1, viewport.width - inset * 2);
	const availableHeight = Math.max(1, viewport.height - inset * 2);
	return Math.min(1, availableWidth / image.width, availableHeight / image.height);
}

export function fittedTransform(viewport: Size, image: Size): ViewportTransform {
	return { scale: fitScale(viewport, image), pan: { x: 0, y: 0 } };
}

export function clampScale(scale: number, fittedScale: number) {
	return clamp(scale, Math.min(MIN_ZOOM_SCALE, fittedScale), MAX_ZOOM_SCALE);
}

export function clampTransform(
	transform: ViewportTransform,
	viewport: Size,
	image: Size,
	overscroll = PAN_OVERSCROLL
): ViewportTransform {
	const scale = clampScale(transform.scale, fitScale(viewport, image));
	const horizontal = panLimit(image.width * scale, viewport.width, overscroll);
	const vertical = panLimit(image.height * scale, viewport.height, overscroll);
	return {
		scale,
		pan: {
			x: clamp(transform.pan.x, -horizontal, horizontal),
			y: clamp(transform.pan.y, -vertical, vertical)
		}
	};
}

export function zoomAt(
	transform: ViewportTransform,
	requestedScale: number,
	anchor: Point,
	viewport: Size,
	image: Size
) {
	const scale = clampScale(requestedScale, fitScale(viewport, image));
	const ratio = scale / transform.scale;
	const center = { x: viewport.width / 2, y: viewport.height / 2 };
	return clampTransform(
		{
			scale,
			pan: {
				x: anchor.x - center.x - (anchor.x - center.x - transform.pan.x) * ratio,
				y: anchor.y - center.y - (anchor.y - center.y - transform.pan.y) * ratio
			}
		},
		viewport,
		image
	);
}

export function panBy(transform: ViewportTransform, delta: Point, viewport: Size, image: Size) {
	return clampTransform(
		{
			scale: transform.scale,
			pan: { x: transform.pan.x + delta.x, y: transform.pan.y + delta.y }
		},
		viewport,
		image
	);
}

export function screenToImage(
	point: Point,
	viewport: Size,
	image: Size,
	transform: ViewportTransform
) {
	return {
		x: (point.x - viewport.width / 2 - transform.pan.x) / transform.scale + image.width / 2,
		y: (point.y - viewport.height / 2 - transform.pan.y) / transform.scale + image.height / 2
	};
}

export function imageToScreen(
	point: Point,
	viewport: Size,
	image: Size,
	transform: ViewportTransform
) {
	return {
		x: viewport.width / 2 + transform.pan.x + (point.x - image.width / 2) * transform.scale,
		y: viewport.height / 2 + transform.pan.y + (point.y - image.height / 2) * transform.scale
	};
}

export function surfaceTransform(viewport: Size, image: Size, transform: ViewportTransform) {
	return {
		x: viewport.width / 2 + transform.pan.x - (image.width * transform.scale) / 2,
		y: viewport.height / 2 + transform.pan.y - (image.height * transform.scale) / 2
	};
}

export function visibleImageSize(viewport: Size, image: Size, transform: ViewportTransform): Size {
	const start = screenToImage({ x: 0, y: 0 }, viewport, image, transform);
	const end = screenToImage({ x: viewport.width, y: viewport.height }, viewport, image, transform);
	const left = clamp(start.x, 0, image.width);
	const top = clamp(start.y, 0, image.height);
	const right = clamp(end.x, 0, image.width);
	const bottom = clamp(end.y, 0, image.height);
	return {
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top)
	};
}

export function nextZoomScale(current: number, direction: -1 | 1, fittedScale: number) {
	const scales = [...new Set([...ZOOM_PRESETS, fittedScale])].sort((a, b) => a - b);
	const epsilon = 0.0001;
	if (direction > 0) return scales.find((scale) => scale > current + epsilon) ?? MAX_ZOOM_SCALE;
	return scales.findLast((scale) => scale < current - epsilon) ?? scales[0];
}

function panLimit(rendered: number, viewport: number, overscroll: number) {
	return Math.max(0, (rendered - viewport) / 2) + overscroll;
}

function validSize(size: Size) {
	return size.width > 0 && size.height > 0;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}

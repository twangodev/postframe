import type { Size } from './photo-viewport.ts';

export interface OverlayFrame {
	image: Size;
	scale: number;
}

/** A length of `px` screen pixels expressed in image units. */
export function hairline(frame: OverlayFrame, px = 1) {
	return px / frame.scale;
}

export function dashes(frame: OverlayFrame, on = 6, off = 4) {
	return `${hairline(frame, on)} ${hairline(frame, off)}`;
}

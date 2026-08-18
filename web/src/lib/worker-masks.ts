import { adjustMaskEdges } from './mask-edge-adjustment.ts';
import type { WasmDevelopedTileCompositor } from './wasm-runtime';
import { wasm } from './worker-wasm.ts';
import type { DevelopedMaskInput, RenderTileRequest } from './worker-protocol.ts';
import { maskDevelopSettings } from './develop-settings.ts';
import { canvasContext, imageData } from './worker-render.ts';
import type { ActiveDocument } from './worker-documents.ts';

export interface ActiveMaskCompositor {
	id: string;
	compositor: WasmDevelopedTileCompositor;
}

let maskCompositors: ActiveMaskCompositor[] = [];

export function hasMaskCompositors() {
	return maskCompositors.length > 0;
}

export function setMaskCompositors(masks: DevelopedMaskInput[]) {
	const next = createMaskCompositors(masks);
	clearMaskCompositors();
	maskCompositors = next;
}

export function createMaskCompositors(masks: DevelopedMaskInput[]) {
	const created: ActiveMaskCompositor[] = [];
	try {
		for (const mask of masks) {
			const adjusted = adjustMaskEdges(
				{
					width: mask.width,
					height: mask.height,
					alpha: new Uint8Array(mask.alpha)
				},
				mask.edge
			);
			created.push({
				id: mask.id,
				compositor: new wasm.DevelopedTileCompositor(
					adjusted.alpha,
					mask.width,
					mask.height,
					maskDevelopSettings(mask.settings)
				)
			});
		}
		return created;
	} catch (error) {
		for (const mask of created) mask.compositor.free();
		throw error;
	}
}

export function clearMaskCompositors() {
	for (const mask of maskCompositors) mask.compositor.free();
	maskCompositors = [];
}

export function compositeDevelopedTile(
	active: ActiveDocument,
	developed: ImageBitmap,
	request: RenderTileRequest
) {
	const context = canvasContext(developed.width, developed.height, false);
	context.drawImage(developed, 0, 0);
	let rgba: Uint8Array = new Uint8Array(
		context.getImageData(0, 0, developed.width, developed.height).data
	);
	const imageWidth = active.kind === 'raw' ? active.session.width() : active.bitmap.width;
	const imageHeight = active.kind === 'raw' ? active.session.height() : active.bitmap.height;
	for (const mask of maskCompositors) {
		rgba = mask.compositor.composite_rgba(
			rgba,
			developed.width,
			developed.height,
			imageWidth,
			imageHeight,
			request.x,
			request.y,
			request.width,
			request.height
		);
	}
	context.putImageData(imageData(rgba, developed.width, developed.height), 0, 0);
	const composited = context.canvas.transferToImageBitmap();
	developed.close();
	return composited;
}

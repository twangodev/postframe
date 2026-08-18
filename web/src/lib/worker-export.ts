import { freeQuietly } from './diagnostics.ts';
import type { WasmDisplayTransform, WasmSession } from './wasm-runtime';
import {
	cropRegion,
	exportTiles,
	identityGeometry,
	rotatedBounds,
	type ExportGeometry,
	type ExportPhase,
	type ExportRegion
} from './export.ts';
import { wasm } from './worker-wasm.ts';
import { post, type Request } from './worker-protocol.ts';
import { canvasContext, displayTransform, imageData } from './worker-render.ts';
import { createMaskCompositors } from './worker-masks.ts';
import type { ActiveDocument } from './worker-documents.ts';

const EXPORT_TILE_SIZE = 1024;

export async function exportDocument(
	active: ActiveDocument,
	request: Extract<Request, { type: 'export' }>
) {
	const progress = (phase: ExportPhase, completed: number, total: number) =>
		post({ id: request.id, type: 'export-progress', phase, completed, total });
	progress('decode', 0, 1);
	const width = active.kind === 'raw' ? active.session.width() : active.bitmap.width;
	const height = active.kind === 'raw' ? active.session.height() : active.bitmap.height;
	progress('decode', 1, 1);
	const developed = developExportImage(active, width, height, request, (completed, total) =>
		progress('develop', completed, total)
	);
	const framed = applyExportGeometry(developed, width, height, request.geometry);
	progress('encode', 0, 1);
	const quality = Math.min(100, Math.max(1, Math.round(request.quality)));
	const original = await originalBytes(active);
	const jpeg = wasm.encode_export_jpeg(framed.rgba, framed.width, framed.height, quality, original);
	return jpeg.buffer as ArrayBuffer;
}

async function originalBytes(active: ActiveDocument) {
	const source = active.kind === 'display' ? active.source : active.metadataSource;
	if (!source) return undefined;
	try {
		const file = await source.getFile();
		return new Uint8Array(await file.arrayBuffer());
	} catch {
		return undefined;
	}
}

function developExportImage(
	active: ActiveDocument,
	width: number,
	height: number,
	request: Extract<Request, { type: 'export' }>,
	onProgress: (completed: number, total: number) => void
) {
	const light =
		active.kind === 'display'
			? displayTransform(active, request.adjustments, request.geometry.crop)
			: null;
	const compositors = createMaskCompositors(request.masks);
	try {
		const rgba = new Uint8Array(width * height * 4);
		const tiles = exportTiles(width, height, EXPORT_TILE_SIZE);
		onProgress(0, tiles.length);
		for (const [index, region] of tiles.entries()) {
			let tile =
				active.kind === 'raw'
					? developRawExportTile(active.session, request, region)
					: developDisplayExportTile(active.bitmap, light!, region, { width, height });
			for (const mask of compositors) {
				tile = mask.compositor.composite_rgba(
					tile,
					region.width,
					region.height,
					width,
					height,
					region.x,
					region.y,
					region.width,
					region.height
				);
			}
			blitExportTile(rgba, width, tile, region);
			onProgress(index + 1, tiles.length);
		}
		return rgba;
	} finally {
		for (const mask of compositors) freeQuietly('mask compositor', mask.compositor);
	}
}

function developRawExportTile(
	session: WasmSession,
	request: Extract<Request, { type: 'export' }>,
	region: ExportRegion
) {
	const tile = session.render_tile(
		region.x,
		region.y,
		region.width,
		region.height,
		1,
		request.adjustments,
		request.geometry.crop,
		true
	);
	try {
		return tile.rgba;
	} finally {
		freeQuietly('export tile', tile);
	}
}

function developDisplayExportTile(
	bitmap: ImageBitmap,
	light: WasmDisplayTransform,
	region: ExportRegion,
	image: { width: number; height: number }
) {
	const context = canvasContext(region.width, region.height);
	context.drawImage(
		bitmap,
		region.x,
		region.y,
		region.width,
		region.height,
		0,
		0,
		region.width,
		region.height
	);
	const pixels = context.getImageData(0, 0, region.width, region.height);
	return light.apply_tile_rgba(
		new Uint8Array(pixels.data.buffer),
		region.width,
		region.height,
		{
			imageWidth: image.width,
			imageHeight: image.height,
			x: region.x,
			y: region.y,
			width: region.width,
			height: region.height
		},
		1
	);
}

function blitExportTile(
	target: Uint8Array,
	imageWidth: number,
	tile: Uint8Array,
	region: ExportRegion
) {
	for (let row = 0; row < region.height; row += 1) {
		target.set(
			tile.subarray(row * region.width * 4, (row + 1) * region.width * 4),
			((region.y + row) * imageWidth + region.x) * 4
		);
	}
}

function applyExportGeometry(
	rgba: Uint8Array,
	width: number,
	height: number,
	geometry: ExportGeometry
) {
	if (identityGeometry(geometry)) return { rgba, width, height };
	const source = canvasContext(width, height, false);
	source.putImageData(imageData(rgba, width, height), 0, 0);
	const bounds = rotatedBounds(width, height, geometry.rotation);
	const framed = canvasContext(bounds.width, bounds.height);
	framed.imageSmoothingEnabled = true;
	framed.imageSmoothingQuality = 'high';
	framed.translate(bounds.width / 2, bounds.height / 2);
	framed.rotate((geometry.rotation * Math.PI) / 180);
	framed.scale(geometry.flipHorizontal ? -1 : 1, geometry.flipVertical ? -1 : 1);
	framed.drawImage(source.canvas, -width / 2, -height / 2);
	const crop = cropRegion(bounds.width, bounds.height, geometry.crop);
	const pixels = framed.getImageData(crop.x, crop.y, crop.width, crop.height);
	return { rgba: new Uint8Array(pixels.data.buffer), width: crop.width, height: crop.height };
}

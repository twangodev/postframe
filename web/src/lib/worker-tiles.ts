import {
	defaultColorSettings,
	developSettingsKey,
	detailTileKey,
	tonalDevelopSettings,
	type DevelopSettings
} from './develop-settings';
import type { WasmSession } from './wasm-runtime';
import type { LinearTileSource } from './webgpu-renderer.ts';
import { wasm } from './worker-wasm.ts';
import type { RenderTileRequest } from './worker-protocol.ts';
import { canvasContext, displayTransform, imageData } from './worker-render.ts';
import { compositeDevelopedTile, hasMaskCompositors } from './worker-masks.ts';
import type { ActiveDocument, RawDocument } from './worker-documents.ts';

export async function renderTile(active: ActiveDocument, request: RenderTileRequest) {
	const developed = await renderDevelopedTile(active, request);
	if (!hasMaskCompositors()) return developed;
	try {
		return compositeDevelopedTile(active, developed, request);
	} catch {
		return developed;
	}
}

async function renderDevelopedTile(active: ActiveDocument, request: RenderTileRequest) {
	if (active.kind === 'raw') {
		if (active.renderer) {
			const key = rawTileKey(request);
			let tile: ReturnType<WasmSession['render_tile_linear']> | null = null;
			try {
				let source: LinearTileSource | null = null;
				if (!active.renderer.hasSource(key)) {
					tile = active.session.render_tile_linear(
						request.x,
						request.y,
						request.width,
						request.height,
						request.bin,
						request.adjustments
					);
					source = {
						rgba: tile.rgba,
						detail: tile.detail,
						width: tile.width,
						height: tile.height
					};
				}
				return await active.renderer.render(
					key,
					source,
					{
						x: request.x,
						y: request.y,
						bin: request.bin,
						imageWidth: active.image.width,
						imageHeight: active.image.height,
						crop: request.crop
					},
					request.adjustments,
					request.tone,
					rawToneTables(active, request.adjustments)
				);
			} catch {
				active.renderer.destroy();
				active.renderer = null;
			} finally {
				tile?.free();
			}
		}
		const tile = active.session.render_tile(
			request.x,
			request.y,
			request.width,
			request.height,
			request.bin,
			request.adjustments,
			request.crop,
			request.tone
		);
		try {
			const context = canvasContext(tile.width, tile.height, false);
			context.putImageData(imageData(tile.rgba, tile.width, tile.height), 0, 0);
			return context.canvas.transferToImageBitmap();
		} finally {
			tile.free();
		}
	}

	const width = Math.ceil(request.width / request.bin);
	const height = Math.ceil(request.height / request.bin);
	const context = canvasContext(width, height);
	context.imageSmoothingEnabled = request.bin > 1;
	context.imageSmoothingQuality = 'high';
	context.drawImage(
		active.bitmap,
		request.x,
		request.y,
		request.width,
		request.height,
		0,
		0,
		width,
		height
	);
	const pixels = context.getImageData(0, 0, width, height);
	const adjusted = displayTransform(active, request.adjustments, request.crop).apply_tile_rgba(
		new Uint8Array(pixels.data),
		width,
		height,
		{
			imageWidth: active.bitmap.width,
			imageHeight: active.bitmap.height,
			x: request.x,
			y: request.y,
			width: request.width,
			height: request.height
		}
	);
	context.putImageData(imageData(adjusted, width, height), 0, 0);
	return context.canvas.transferToImageBitmap();
}

function rawTileKey(tile: RenderTileRequest) {
	const region = `${tile.x}:${tile.y}:${tile.width}:${tile.height}:${tile.bin}`;
	return `${region}:${detailTileKey(tile.adjustments.detail)}`;
}

// The shader applies exposure and color itself, so the tables only have to
// carry the stages Rust resolves: the light response composed with the
// luminance curve, and the three channel curves.
function rawToneTables(active: RawDocument, adjustments: DevelopSettings) {
	const key = developSettingsKey(adjustments);
	if (active.toneTables?.key === key) return active.toneTables;
	const transform = new wasm.DisplayTransform(
		{
			...tonalDevelopSettings({ ...adjustments.light, exposure: 0 }, defaultColorSettings()),
			curve: adjustments.curve
		},
		null
	);
	try {
		const tables = {
			key,
			luminance: transform.luminance_lut,
			channels: transform.channel_luts
		};
		active.toneTables = tables;
		return tables;
	} finally {
		transform.free();
	}
}

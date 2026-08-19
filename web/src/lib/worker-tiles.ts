import { paintClipping, showsClipping, type ClippingIndicators } from './clipping.ts';
import { freeQuietly, reportError } from './diagnostics.ts';
import {
	defaultColorSettings,
	detailTileKey,
	developSettingsKey,
	type DevelopSettings
} from './develop-settings';
import type { WasmSession } from './wasm-runtime';
import type { LinearTileSource } from './webgpu-renderer.ts';
import { wasm } from './worker-wasm.ts';
import type { RenderTileRequest } from './worker-protocol.ts';
import { canvasContext, developDisplayRegion, imageData } from './worker-display.ts';
import { displayTransform } from './worker-render.ts';
import { compositeDevelopedTile, hasMaskCompositors } from './worker-masks.ts';
import type { ActiveDocument, RawDocument } from './worker-documents.ts';

export async function renderTile(active: ActiveDocument, request: RenderTileRequest) {
	const developed = await renderDevelopedTile(active, request);
	const composited = hasMaskCompositors() ? compositeMasks(active, developed, request) : developed;
	return request.clipping && showsClipping(request.clipping)
		? paintClippedTile(composited, request.clipping)
		: composited;
}

function compositeMasks(
	active: ActiveDocument,
	developed: ImageBitmap,
	request: RenderTileRequest
) {
	try {
		return compositeDevelopedTile(active, developed, request);
	} catch (error) {
		reportError('mask compositing fell back to the developed tile', error);
		return developed;
	}
}

function paintClippedTile(tile: ImageBitmap, clipping: ClippingIndicators) {
	const context = canvasContext(tile.width, tile.height, false);
	context.drawImage(tile, 0, 0);
	const pixels = context.getImageData(0, 0, tile.width, tile.height);
	paintClipping(pixels.data, clipping);
	context.putImageData(pixels, 0, 0);
	tile.close();
	return context.canvas.transferToImageBitmap();
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
					rawDevelopLuts(active, request.adjustments)
				);
			} catch (error) {
				reportError('gpu tile render failed; falling back to the cpu path', error);
				active.renderer.destroy();
				active.renderer = null;
			} finally {
				if (tile) freeQuietly('linear tile', tile);
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
			freeQuietly('rendered tile', tile);
		}
	}

	const developed = developDisplayRegion(
		active.bitmap,
		displayTransform(active, request.adjustments, request.crop),
		request,
		{ width: active.bitmap.width, height: active.bitmap.height }
	);
	const context = canvasContext(developed.width, developed.height, false);
	context.putImageData(developed, 0, 0);
	return context.canvas.transferToImageBitmap();
}

function rawTileKey(tile: RenderTileRequest) {
	const region = `${tile.x}:${tile.y}:${tile.width}:${tile.height}:${tile.bin}`;
	return `${region}:${detailTileKey(tile.adjustments.detail)}`;
}

// Shader already applies exposure and color; tables cover only the remaining stages Rust resolves.
function rawDevelopLuts(active: RawDocument, adjustments: DevelopSettings) {
	const key = developSettingsKey(adjustments);
	if (active.developLuts?.key === key) return active.developLuts;
	const transform = new wasm.DisplayTransform(
		{
			...adjustments,
			light: { ...adjustments.light, exposure: 0 },
			color: defaultColorSettings()
		},
		null
	);
	try {
		const luts = {
			key,
			luminance: transform.luminance_lut,
			channels: transform.channel_luts,
			mixer: transform.mixer_luts,
			grading: transform.grading_scalars
		};
		active.developLuts = luts;
		return luts;
	} finally {
		freeQuietly('develop luts', transform);
	}
}

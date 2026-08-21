import {
	cloneDevelopSettings,
	cloneMaskAdjustments,
	neutralMaskAdjustments,
	type DevelopSettings
} from './develop-settings';
import {
	cloneCrop,
	cloneEditMask,
	type EditDocument,
	type EditMask,
	type MaskComponent,
	type NormalizedCrop
} from './edit-document';
import type { EditDocumentStore } from './library-backend.ts';
import { isNeutralMaskEdge } from './mask-edge-settings';
import {
	composeMaskRasters,
	maskDigest,
	type MaskRasterData,
	type MaskRasterLayer
} from './mask-raster';
import type { SmartMaskRaster } from './smart-mask';
import type { Photo } from './photo-record';
import type { PostframeWorkerClient } from './worker-client';

export interface SelectedMaskRaster extends MaskRasterData {
	maskId: string;
}

export interface MaskRasterPipelineHost {
	readonly selectedPhoto: Photo | null;
	readonly selectedMaskId: string | null;
	masks: EditMask[];
	selectedMaskRaster: SelectedMaskRaster | null;
	renderSettings: { adjustments: DevelopSettings; crop: NormalizedCrop | null; revision: number };
	markRefining(revision: number): void;
	failSmartMask(error: unknown): void;
}

export class MaskRasterPipeline {
	private renderRevision = 0;
	private previewRevision = 0;
	private renderTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly rasterCache = new Map<string, MaskRasterData>();
	private readonly adjustedRasterCache = new Map<string, { key: string; raster: MaskRasterData }>();

	constructor(
		private readonly service: EditDocumentStore | null,
		private readonly workerClient: PostframeWorkerClient | null,
		private readonly host: MaskRasterPipelineHost
	) {}

	scheduleMaskRender(document: EditDocument, refreshRaster = false) {
		this.clearMaskRenderTimer();
		this.renderTimer = setTimeout(() => {
			this.renderTimer = null;
			this.renderEditDocument(document);
			if (refreshRaster) void this.refreshSelectedMaskRaster();
		}, 40);
	}

	clearMaskRenderTimer() {
		if (this.renderTimer === null) return;
		clearTimeout(this.renderTimer);
		this.renderTimer = null;
	}

	resetPreview() {
		if (!this.host.selectedPhoto) return;
		this.host.masks = this.host.selectedPhoto.edit.masks.map(cloneEditMask);
		this.renderEditDocument(this.host.selectedPhoto.edit);
		void this.refreshSelectedMaskRaster();
	}

	renderEditDocument(document: EditDocument) {
		const revision = ++this.renderRevision;
		void this.renderMasks(document)
			.then(async (masks) => {
				if (revision !== this.renderRevision) return;
				await this.workerClient?.setMasks(masks);
				if (revision !== this.renderRevision) return;
				this.publishRenderSettings(document);
			})
			.catch(async (error) => {
				if (revision !== this.renderRevision) return;
				await this.workerClient?.setMasks([]).catch(() => {});
				if (revision !== this.renderRevision) return;
				this.publishRenderSettings(document);
				this.host.failSmartMask(error);
			});
	}

	private publishRenderSettings(document: EditDocument) {
		this.host.renderSettings = {
			adjustments: cloneDevelopSettings(document.adjustments),
			crop: cloneCrop(document.geometry.crop),
			revision: this.host.renderSettings.revision + 1
		};
		this.host.markRefining(this.host.renderSettings.revision);
	}

	async clearMaskCompositors() {
		await this.workerClient?.setMasks([]).catch(() => {});
	}

	async installMaskCompositors(document: EditDocument, stillCurrent: () => boolean) {
		try {
			const masks = await this.renderMasks(document);
			if (!stillCurrent()) return;
			await this.workerClient?.setMasks(masks);
		} catch (error) {
			if (!stillCurrent()) return;
			await this.workerClient?.setMasks([]).catch(() => {});
			this.host.failSmartMask(error);
		}
	}

	async renderMasks(document: EditDocument) {
		const masks = await Promise.all(
			document.masks.map(async (mask) => {
				if (!mask.visible || neutralMaskAdjustments(mask.adjustments)) return null;
				const raster = await this.composedMaskRaster(mask);
				if (!raster) return null;
				return {
					id: mask.id,
					width: raster.width,
					height: raster.height,
					alpha: raster.alpha.slice().buffer as ArrayBuffer,
					edge: { ...mask.edge },
					settings: cloneMaskAdjustments(mask.adjustments)
				};
			})
		);
		return masks.filter((mask): mask is NonNullable<typeof mask> => mask !== null);
	}

	private async composedMaskRaster(mask: EditMask) {
		const layers = await Promise.all(
			mask.components.map(async (component): Promise<MaskRasterLayer | null> => {
				if (!component.raster) return null;
				return {
					operation: component.operation,
					inverted: component.type === 'ai-subject' && component.inverted,
					raster: await this.maskRaster(component.raster)
				};
			})
		);
		return composeMaskRasters(layers.filter((layer): layer is MaskRasterLayer => layer !== null));
	}

	async maskRaster(reference: NonNullable<MaskComponent['raster']>) {
		const key = `${reference.storageName}:${reference.digest}`;
		const cached = this.rasterCache.get(key);
		if (cached) return cached;
		if (!this.service) throw new Error('Mask storage is unavailable');
		const alpha = new Uint8Array(await this.service.readMaskRaster(reference.storageName));
		if (alpha.length !== reference.width * reference.height) {
			throw new Error(`Mask ${reference.storageName} has invalid dimensions`);
		}
		if ((await maskDigest(alpha)) !== reference.digest) {
			throw new Error(`Mask ${reference.storageName} failed validation`);
		}
		const raster = { width: reference.width, height: reference.height, alpha };
		this.rasterCache.set(key, raster);
		return raster;
	}

	async persistMaskRaster(photoId: string, componentId: string, raster: SmartMaskRaster) {
		if (!this.service) throw new Error('Mask storage is unavailable');
		const digest = await maskDigest(raster.alpha);
		const storageName = await this.service.saveMaskRaster(
			photoId,
			`${componentId}-${digest.slice(0, 16)}`,
			raster.alpha
		);
		this.rasterCache.set(`${storageName}:${digest}`, {
			width: raster.width,
			height: raster.height,
			alpha: raster.alpha.slice()
		});
		return { storageName, width: raster.width, height: raster.height, digest };
	}

	async refreshSelectedMaskRaster() {
		const revision = ++this.previewRevision;
		const maskId = this.host.selectedMaskId;
		const mask = this.host.masks.find(({ id }) => id === maskId);
		if (!maskId || !mask) {
			this.host.selectedMaskRaster = null;
			return;
		}
		try {
			const raster = await this.adjustedMaskRaster(mask);
			if (revision !== this.previewRevision || this.host.selectedMaskId !== maskId) return;
			this.host.selectedMaskRaster = raster ? { maskId, ...raster } : null;
		} catch (error) {
			if (revision === this.previewRevision && this.host.selectedMaskId === maskId) {
				this.host.selectedMaskRaster = null;
			}
			this.host.failSmartMask(error);
		}
	}

	private async adjustedMaskRaster(mask: EditMask) {
		const key = JSON.stringify({
			edge: mask.edge,
			components: mask.components.map((component) => ({
				type: component.type,
				operation: component.operation,
				inverted: component.type === 'ai-subject' && component.inverted,
				raster: component.raster?.digest ?? null
			}))
		});
		const cached = this.adjustedRasterCache.get(mask.id);
		if (cached?.key === key) return cached.raster;
		const raster = await this.composedMaskRaster(mask);
		if (!raster) return null;
		const alpha =
			this.workerClient && !isNeutralMaskEdge(mask.edge)
				? await this.workerClient.adjustMask({
						width: raster.width,
						height: raster.height,
						alpha: raster.alpha.buffer as ArrayBuffer,
						edge: mask.edge
					})
				: raster.alpha.slice();
		const adjusted = { width: raster.width, height: raster.height, alpha };
		this.adjustedRasterCache.set(mask.id, { key, raster: adjusted });
		return adjusted;
	}

	invalidate() {
		this.renderRevision += 1;
		this.clearMaskRenderTimer();
	}

	clearCaches() {
		this.rasterCache.clear();
		this.adjustedRasterCache.clear();
	}
}

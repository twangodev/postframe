import {
	cloneDevelopSettings,
	defaultDevelopSettings,
	type DevelopSettings
} from './develop-settings.ts';
import { cloneCrop, type EditDocument, type NormalizedCrop } from './edit-document.ts';
import type { Photo } from './photo-record.ts';

export interface DevelopComparisonPipeline {
	clearMaskCompositors(): Promise<void>;
	installMaskCompositors(document: EditDocument, stillCurrent: () => boolean): Promise<void>;
}

export interface DevelopComparisonHost {
	readonly selectedPhoto: Photo | null;
	readonly canAdjustLight: boolean;
	comparingOriginal: boolean;
	renderSettings: {
		adjustments: DevelopSettings;
		crop: NormalizedCrop | null;
		revision: number;
	};
}

export class DevelopComparison {
	private readonly pipeline: DevelopComparisonPipeline;
	private readonly host: DevelopComparisonHost;
	private generation = 0;

	constructor(pipeline: DevelopComparisonPipeline, host: DevelopComparisonHost) {
		this.pipeline = pipeline;
		this.host = host;
	}

	async set(comparing: boolean) {
		await (comparing ? this.show() : this.hide());
	}

	async show() {
		const photo = this.host.selectedPhoto;
		if (this.host.comparingOriginal || !this.host.canAdjustLight || !photo) return;
		const generation = ++this.generation;
		this.host.comparingOriginal = true;
		await this.pipeline.clearMaskCompositors();
		if (generation !== this.generation) return;
		this.publish(defaultDevelopSettings(), photo.edit.geometry.crop);
	}

	async hide() {
		const photo = this.host.selectedPhoto;
		if (!this.host.comparingOriginal) return;
		const generation = ++this.generation;
		this.host.comparingOriginal = false;
		if (!photo) return;
		await this.pipeline.installMaskCompositors(photo.edit, () => generation === this.generation);
		if (generation !== this.generation) return;
		this.publish(photo.edit.adjustments, photo.edit.geometry.crop);
	}

	private publish(adjustments: DevelopSettings, crop: NormalizedCrop | null) {
		this.host.renderSettings = {
			adjustments: cloneDevelopSettings(adjustments),
			crop: cloneCrop(crop),
			revision: this.host.renderSettings.revision + 1
		};
	}
}

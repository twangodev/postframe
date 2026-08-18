import {
	colorRangeSchema,
	defaultColorRange,
	defaultLuminanceRange,
	luminanceRangeSchema,
	type ColorRange,
	type ColorRangeComponent,
	type EditMask,
	type LuminanceRange,
	type LuminanceRangeComponent,
	type MaskOperation
} from './edit-document.ts';
import type { EditorCommand } from './editor-command';
import { entityId } from './entity-id.ts';
import type { MaskRasterData } from './mask-raster';
import type { MaskRasterPipeline, SelectedMaskRaster } from './mask-raster-pipeline';
import { PAINT_RASTER_MAX_DIMENSION } from './mask-rasterizer.ts';
import type { Photo } from './photo-record';
import type { PostframeWorkerClient } from './worker-client';
import type { RangeComponentInput } from './worker-protocol';

export type RangeKind = 'luminance' | 'color';
export type RangeComponent = LuminanceRangeComponent | ColorRangeComponent;
export type RangeSettings = LuminanceRange | ColorRange;

export const RANGE_PREVIEW_DEBOUNCE_MS = 80;

export interface MaskRangingHost {
	readonly selectedPhoto: Photo | null;
	readonly canAdjustLight: boolean;
	readonly masks: EditMask[];
	readonly selectedMaskId: string | null;
	readonly maskStorageAvailable: boolean;
	selectedMaskRaster: SelectedMaskRaster | null;
	dispatchEditorCommand(command: EditorCommand): boolean;
	selectMask(maskId: string | null): void;
	failSmartMask(error: unknown): void;
}

type RangeRasterizer = Pick<PostframeWorkerClient, 'rasterizeRange'>;
type RangeStore = Pick<MaskRasterPipeline, 'persistMaskRaster'>;

interface RangeTarget {
	photo: Photo;
	mask: EditMask;
	component: RangeComponent;
}

interface PendingPreview {
	maskId: string;
	componentId: string;
	input: RangeComponentInput;
}

interface PreviewedRaster {
	componentId: string;
	key: string;
	raster: MaskRasterData;
}

export class MaskRanging {
	private readonly workerClient: RangeRasterizer | null;
	private readonly pipeline: RangeStore;
	private readonly host: MaskRangingHost;
	private readonly debounceMs: number;
	private previewTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingPreview: PendingPreview | null = null;
	private previewRevision = 0;
	private previewed: PreviewedRaster | null = null;

	constructor(
		workerClient: RangeRasterizer | null,
		pipeline: RangeStore,
		host: MaskRangingHost,
		debounceMs = RANGE_PREVIEW_DEBOUNCE_MS
	) {
		this.workerClient = workerClient;
		this.pipeline = pipeline;
		this.host = host;
		this.debounceMs = debounceMs;
	}

	addRangeComponent = async (kind: RangeKind, operation: MaskOperation) => {
		const photo = this.readyPhoto();
		if (!photo) return;
		const mask = this.host.masks.find(({ id }) => id === this.host.selectedMaskId);
		if (!mask) return;
		const component = defaultRangeComponent(kind, operation);
		await this.commitComponent({ photo, mask, component }, component.range);
	};

	previewRange = (componentId: string, range: RangeSettings) => {
		const target = this.rangeTarget(componentId);
		if (!target || !this.workerClient) return;
		let input: RangeComponentInput;
		try {
			input = rangeInput(rangedComponent(target.component, range));
		} catch (error) {
			this.host.failSmartMask(error);
			return;
		}
		this.pendingPreview = { maskId: target.mask.id, componentId: target.component.id, input };
		if (this.previewTimer !== null) clearTimeout(this.previewTimer);
		this.previewTimer = setTimeout(() => {
			this.previewTimer = null;
			void this.paintPreview();
		}, this.debounceMs);
	};

	commitRange = async (componentId: string, range: RangeSettings) => {
		const target = this.rangeTarget(componentId);
		if (!target) return;
		await this.commitComponent(target, range);
	};

	private async paintPreview() {
		const pending = this.pendingPreview;
		this.pendingPreview = null;
		if (!pending || !this.workerClient) return;
		const revision = ++this.previewRevision;
		try {
			const raster = await this.workerClient.rasterizeRange(
				pending.input,
				PAINT_RASTER_MAX_DIMENSION
			);
			if (revision !== this.previewRevision || this.host.selectedMaskId !== pending.maskId) return;
			this.previewed = {
				componentId: pending.componentId,
				key: previewKey(pending.input),
				raster
			};
			this.host.selectedMaskRaster = { maskId: pending.maskId, ...raster };
		} catch (error) {
			if (revision !== this.previewRevision) return;
			this.host.failSmartMask(error);
		}
	}

	private async commitComponent({ photo, mask, component }: RangeTarget, range: RangeSettings) {
		this.cancelPreview();
		if (!this.workerClient) return;
		try {
			const ranged = rangedComponent(component, range);
			const raster = await this.rasterFor(ranged.id, rangeInput(ranged));
			const reference = await this.pipeline.persistMaskRaster(photo.id, ranged.id, raster);
			if (this.host.selectedPhoto?.id !== photo.id) return;
			this.host.dispatchEditorCommand({
				type: 'mask.component.set',
				maskId: mask.id,
				component: { ...ranged, raster: reference }
			});
			this.host.selectMask(mask.id);
		} catch (error) {
			this.host.failSmartMask(error);
		}
	}

	private async rasterFor(componentId: string, input: RangeComponentInput) {
		const key = previewKey(input);
		if (this.previewed?.componentId === componentId && this.previewed.key === key) {
			return this.previewed.raster;
		}
		return this.workerClient!.rasterizeRange(input, PAINT_RASTER_MAX_DIMENSION);
	}

	private cancelPreview() {
		this.previewRevision += 1;
		this.pendingPreview = null;
		if (this.previewTimer === null) return;
		clearTimeout(this.previewTimer);
		this.previewTimer = null;
	}

	private readyPhoto() {
		if (!this.host.maskStorageAvailable) {
			this.host.failSmartMask(new Error('Range masks need local browser storage'));
			return null;
		}
		const photo = this.host.selectedPhoto;
		if (!photo || !this.host.canAdjustLight) {
			this.host.failSmartMask(new Error('Photo is not ready for range masks'));
			return null;
		}
		return photo;
	}

	private rangeTarget(componentId: string): RangeTarget | null {
		const photo = this.readyPhoto();
		if (!photo) return null;
		for (const mask of this.host.masks) {
			const component = mask.components.find(
				(candidate): candidate is RangeComponent =>
					candidate.id === componentId && isRangeComponent(candidate)
			);
			if (component) return { photo, mask, component };
		}
		return null;
	}
}

export function isRangeComponent(
	component: EditMask['components'][number]
): component is RangeComponent {
	return component.type === 'luminance-range' || component.type === 'color-range';
}

export function rangeComponents(mask: EditMask | null): RangeComponent[] {
	return mask?.components.filter(isRangeComponent) ?? [];
}

function defaultRangeComponent(kind: RangeKind, operation: MaskOperation): RangeComponent {
	const base = { id: entityId('component'), operation, raster: null };
	return kind === 'luminance'
		? { ...base, type: 'luminance-range', range: defaultLuminanceRange() }
		: { ...base, type: 'color-range', range: defaultColorRange() };
}

function rangedComponent(component: RangeComponent, range: RangeSettings): RangeComponent {
	return component.type === 'luminance-range'
		? { ...component, range: luminanceRangeSchema.parse(range) }
		: { ...component, range: colorRangeSchema.parse(range) };
}

function rangeInput(component: RangeComponent): RangeComponentInput {
	return component.type === 'luminance-range'
		? { type: component.type, range: component.range }
		: { type: component.type, range: component.range };
}

function previewKey(input: RangeComponentInput) {
	return JSON.stringify(input);
}

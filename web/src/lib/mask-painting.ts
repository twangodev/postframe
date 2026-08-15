import type {
	EditMask,
	MaskComponent,
	MaskKind,
	MaskOperation,
	NormalizedPoint
} from './edit-document';
import type { EditorCommand } from './editor-command';
import { entityId } from './entity-id';
import type { MaskRasterPipeline } from './mask-raster-pipeline';
import {
	paintRasterDimensions,
	rasterizeBrushStrokes,
	rasterizeLinearGradient,
	rasterizeRadialGradient,
	rasterizeStrokeOnto,
	type MaskBrushStroke
} from './mask-rasterizer';
import type { Photo } from './photo-record';
import type { SmartMasking } from './smart-masking';

interface MaskPaintContext {
	photo: Photo;
	paintDims: { width: number; height: number };
	mask: EditMask;
}

export interface MaskPaintingHost {
	readonly selectedPhoto: Photo | null;
	readonly canAdjustLight: boolean;
	readonly editPreview: { src: string; width: number; height: number } | null;
	readonly masks: EditMask[];
	readonly selectedMaskId: string | null;
	readonly maskStorageAvailable: boolean;
	dispatchEditorCommand(command: EditorCommand): boolean;
	selectMask(maskId: string | null): void;
}

export class MaskPainting {
	constructor(
		private readonly pipeline: MaskRasterPipeline,
		private readonly session: SmartMasking,
		private readonly host: MaskPaintingHost
	) {}

	paintBrushMask = async (stroke: MaskBrushStroke, operation: MaskOperation = 'add') => {
		const target = this.paintableMask();
		if (!target || stroke.points.length === 0) return;
		const existing = target.mask.components.find(
			(component): component is Extract<MaskComponent, { type: 'brush' }> =>
				component.type === 'brush' && component.operation === operation
		);
		const strokes = [...(existing?.strokes ?? []), stroke];
		await this.commitRasterizedComponent(
			target,
			{
				id: existing?.id ?? entityId('component'),
				type: 'brush',
				operation,
				strokes,
				raster: null
			},
			await this.brushStrokesRaster(target.paintDims, existing, stroke, strokes)
		);
	};

	placeLinearMask = async (start: NormalizedPoint, end: NormalizedPoint) => {
		const target = this.paintableMask('linear');
		if (!target || (start.x === end.x && start.y === end.y)) return;
		const existing = target.mask.components.find((component) => component.type === 'linear');
		await this.commitRasterizedComponent(
			target,
			{
				id: existing?.id ?? entityId('component'),
				type: 'linear',
				operation: existing?.operation ?? 'add',
				start,
				end,
				raster: null
			},
			rasterizeLinearGradient({ start, end }, target.paintDims.width, target.paintDims.height)
		);
	};

	placeRadialMask = async (center: NormalizedPoint, radius: number) => {
		const target = this.paintableMask('radial');
		if (!target || radius <= 0) return;
		const existing = target.mask.components.find(
			(component): component is Extract<MaskComponent, { type: 'radial' }> =>
				component.type === 'radial'
		);
		const geometry = { center, radius: Math.min(1, radius), feather: existing?.feather ?? 0.5 };
		await this.commitRasterizedComponent(
			target,
			{
				id: existing?.id ?? entityId('component'),
				type: 'radial',
				operation: existing?.operation ?? 'add',
				...geometry,
				raster: null
			},
			rasterizeRadialGradient(geometry, target.paintDims.width, target.paintDims.height)
		);
	};

	private async brushStrokesRaster(
		paintDims: { width: number; height: number },
		existing: Extract<MaskComponent, { type: 'brush' }> | undefined,
		stroke: MaskBrushStroke,
		strokes: MaskBrushStroke[]
	) {
		if (
			existing?.raster &&
			existing.raster.width === paintDims.width &&
			existing.raster.height === paintDims.height &&
			existing.strokes.length > 0
		) {
			try {
				const base = await this.pipeline.maskRaster(existing.raster);
				return rasterizeStrokeOnto(base.alpha.slice(), stroke, paintDims.width, paintDims.height);
			} catch {
				// Fall through to a full re-rasterization.
			}
		}
		return rasterizeBrushStrokes(strokes, paintDims.width, paintDims.height);
	}

	private paintableMask(kind?: MaskKind): MaskPaintContext | null {
		if (!this.host.maskStorageAvailable) {
			this.session.fail(new Error('Mask painting needs local browser storage'));
			return null;
		}
		const photo = this.host.selectedPhoto;
		const preview = this.host.editPreview;
		if (!photo || !this.host.canAdjustLight || !preview) {
			this.session.fail(new Error('Photo is not ready for mask painting'));
			return null;
		}
		const mask = this.host.masks.find(({ id }) => id === this.host.selectedMaskId);
		if (!mask || (kind !== undefined && mask.kind !== kind)) return null;
		return { photo, paintDims: paintRasterDimensions(preview.width, preview.height), mask };
	}

	private async commitRasterizedComponent(
		{ photo, paintDims, mask }: MaskPaintContext,
		component: MaskComponent,
		alpha: Uint8Array
	) {
		const revision = this.session.nextRevision();
		try {
			const raster = await this.pipeline.persistMaskRaster(photo.id, component.id, {
				width: paintDims.width,
				height: paintDims.height,
				alpha
			});
			if (revision !== this.session.revision || this.host.selectedPhoto?.id !== photo.id) return;
			this.host.dispatchEditorCommand({
				type: 'mask.component.set',
				maskId: mask.id,
				component: { ...component, raster }
			});
			this.host.selectMask(mask.id);
		} catch (error) {
			this.session.fail(error);
		}
	}
}

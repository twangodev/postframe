import type { EditMask, MaskComponent, MaskKind, MaskOperation } from './edit-document';
import type { EditorCommand } from './editor-command';
import { entityId } from './entity-id.ts';
import type { MaskRasterPipeline } from './mask-raster-pipeline';
import {
	paintRasterDimensions,
	rasterizeBrushStrokes,
	rasterizeLinearGradient,
	rasterizeRadialGradient,
	rasterizeStrokeOnto,
	type MaskBrushStroke
} from './mask-rasterizer.ts';
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

export type GradientComponent = Extract<MaskComponent, { type: 'linear' | 'radial' }>;

export class MaskPainting {
	private readonly pipeline: MaskRasterPipeline;
	private readonly session: SmartMasking;
	private readonly host: MaskPaintingHost;

	constructor(pipeline: MaskRasterPipeline, session: SmartMasking, host: MaskPaintingHost) {
		this.pipeline = pipeline;
		this.session = session;
		this.host = host;
	}

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

	placeGradientComponent = async (component: GradientComponent) => {
		const target = this.paintableMask(component.type);
		if (!target) return;
		const alpha =
			component.type === 'linear'
				? rasterizeLinearGradient(component, target.paintDims.width, target.paintDims.height)
				: rasterizeRadialGradient(component, target.paintDims.width, target.paintDims.height);
		await this.commitRasterizedComponent(target, { ...component, raster: null }, alpha);
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

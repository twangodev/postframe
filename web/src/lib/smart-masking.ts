import {
	createEditMask,
	type EditMask,
	type MaskComponent,
	type NormalizedPoint
} from './edit-document';
import type { EditorCommand } from './editor-command';
import { entityId } from './entity-id';
import type { MaskRasterPipeline } from './mask-raster-pipeline';
import type { Photo } from './photo-record';
import type { MaskEdgeStroke, SmartMaskProgress } from './smart-mask';
import { SmartMaskClient } from './smart-mask-client';
import { detectedSubjectName, type DetectedSubject } from './subject-detection';

export type SmartMaskStatus = SmartMaskProgress & { error: string | null };

export interface SubjectChoices {
	photoId: string;
	subjects: DetectedSubject[];
	created: number[];
}

export interface SmartMaskingHost {
	readonly selectedPhoto: Photo | null;
	readonly canAdjustLight: boolean;
	readonly editPreview: { src: string; width: number; height: number } | null;
	readonly masks: EditMask[];
	readonly selectedMaskId: string | null;
	readonly maskStorageAvailable: boolean;
	subjectChoices: SubjectChoices | null;
	smartMaskStatus: SmartMaskStatus;
	modelPreloadStatus: SmartMaskStatus;
	dispatchEditorCommand(command: EditorCommand): boolean;
	selectMask(maskId: string | null): void;
}

export class SmartMasking {
	private client: SmartMaskClient | null = null;
	private modelWarmupId: number | null = null;
	private removeProgressListener: (() => void) | null = null;
	private preparedPhotoId: string | null = null;
	private preparing: { photoId: string; promise: Promise<void> } | null = null;
	private sessionRevision = 0;
	private activePhotoId: string | null = null;

	constructor(
		private readonly pipeline: MaskRasterPipeline,
		private readonly host: SmartMaskingHost
	) {}

	get revision() {
		return this.sessionRevision;
	}

	nextRevision() {
		return ++this.sessionRevision;
	}

	paintObjectMask = async (
		points: NormalizedPoint[],
		label: 'foreground' | 'background' = 'foreground'
	) => {
		const photo = this.smartMaskPhoto();
		if (!photo || points.length === 0) return;
		this.begin(photo.id);
		const revision = ++this.sessionRevision;
		try {
			await this.ensurePrepared(photo.id);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;

			const existing = this.host.masks.find(
				(mask) => mask.id === this.host.selectedMaskId && mask.kind === 'object'
			);
			const previous = existing?.components.find(
				(component): component is Extract<MaskComponent, { type: 'ai-object' }> =>
					component.type === 'ai-object'
			);
			const prompts = [...(previous?.prompts ?? []), { label, points }];
			if (!prompts.some((prompt) => prompt.label === 'foreground')) {
				throw new Error('Paint over the object before subtracting from it');
			}
			const componentId = previous?.id ?? entityId('component');
			const raster = await this.client!.selectObject(photo.id, componentId, prompts);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;

			const mask = existing ?? createEditMask(entityId('mask'), 'object');
			const component = {
				id: componentId,
				type: 'ai-object',
				operation: 'add',
				modelVersion: this.client!.modelVersion,
				alternatives: raster.alternatives,
				prompts,
				raster: await this.pipeline.persistMaskRaster(photo.id, componentId, raster)
			} satisfies MaskComponent;
			if (existing) {
				this.host.dispatchEditorCommand({
					type: 'mask.component.set',
					maskId: existing.id,
					component
				});
			} else {
				mask.components.push(component);
				this.host.dispatchEditorCommand({ type: 'mask.create', mask });
			}
			this.host.selectMask(mask.id);
			this.finish();
		} catch (error) {
			this.fail(error);
		}
	};

	cycleObjectMaskCandidate = async (direction: -1 | 1) => {
		const photo = this.smartMaskPhoto();
		if (!photo || !this.host.selectedMaskId) return;
		const mask = this.host.masks.find(({ id }) => id === this.host.selectedMaskId);
		const component = mask?.components.find(
			(candidate): candidate is Extract<MaskComponent, { type: 'ai-object' }> =>
				candidate.type === 'ai-object'
		);
		if (!mask || !component?.alternatives || component.alternatives.count < 2) return;

		this.begin(photo.id);
		const revision = ++this.sessionRevision;
		try {
			await this.ensurePrepared(photo.id);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			const candidate = component.alternatives.index + direction;
			const raster = await this.client!.selectObject(
				photo.id,
				component.id,
				component.prompts,
				candidate
			);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			this.host.dispatchEditorCommand({
				type: 'mask.component.set',
				maskId: mask.id,
				component: {
					...component,
					modelVersion: this.client!.modelVersion,
					alternatives: raster.alternatives,
					raster: await this.pipeline.persistMaskRaster(photo.id, component.id, raster)
				}
			});
			this.host.selectMask(mask.id);
			this.finish();
		} catch (error) {
			this.fail(error);
		}
	};

	cycleInstanceMaskCandidate = async (direction: -1 | 1) => {
		const photo = this.smartMaskPhoto();
		if (!photo || !this.host.selectedMaskId) return;
		const mask = this.host.masks.find(({ id }) => id === this.host.selectedMaskId);
		const component = mask?.components.find(
			(candidate): candidate is Extract<MaskComponent, { type: 'ai-instance' }> =>
				candidate.type === 'ai-instance'
		);
		if (!mask || !component?.alternatives || component.alternatives.count < 2) return;

		this.begin(photo.id);
		const revision = ++this.sessionRevision;
		try {
			await this.ensurePrepared(photo.id);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			const candidate = component.alternatives.index + direction;
			const raster = await this.client!.selectInstance(
				photo.id,
				component.id,
				component.box,
				candidate
			);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			this.host.dispatchEditorCommand({
				type: 'mask.component.set',
				maskId: mask.id,
				component: {
					...component,
					modelVersion: this.client!.modelVersion,
					alternatives: raster.alternatives,
					raster: await this.pipeline.persistMaskRaster(photo.id, component.id, raster)
				}
			});
			this.host.selectMask(mask.id);
			this.finish();
		} catch (error) {
			this.fail(error);
		}
	};

	refineMaskEdge = async (stroke: MaskEdgeStroke) => {
		const photo = this.smartMaskPhoto();
		if (!photo || !this.host.selectedMaskId) return;
		const mask = this.host.masks.find(({ id }) => id === this.host.selectedMaskId);
		const components = mask?.components.filter(
			(component): component is Extract<MaskComponent, { type: 'ai-object' | 'ai-subject' }> =>
				(component.type === 'ai-object' || component.type === 'ai-subject') &&
				component.raster !== null
		);
		const component = components?.length === 1 ? components[0] : null;
		if (!mask || !component?.raster) {
			this.fail(new Error('Choose one generated mask before refining its edge'));
			return;
		}

		this.begin(photo.id);
		const revision = ++this.sessionRevision;
		try {
			await this.ensurePrepared(photo.id);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			const source = await this.pipeline.maskRaster(component.raster);
			const refined = await this.client!.refineEdge(photo.id, source, stroke);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			const updated = {
				...component,
				raster: await this.pipeline.persistMaskRaster(photo.id, component.id, refined)
			};
			this.host.dispatchEditorCommand({
				type: 'mask.component.set',
				maskId: mask.id,
				component: updated
			});
			this.host.selectMask(mask.id);
			this.finish();
		} catch (error) {
			this.fail(error);
		}
	};

	async beginSubjectMasks() {
		const photo = this.smartMaskPhoto();
		if (!photo) return;
		this.host.subjectChoices = null;
		this.begin(photo.id);
		const revision = ++this.sessionRevision;
		try {
			await this.ensurePrepared(photo.id);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			const subjects = await this.client!.detectSubjects(photo.id);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			if (subjects.length < 2) {
				await this.createSemanticMask('subject');
				return;
			}
			this.host.subjectChoices = { photoId: photo.id, subjects, created: [] };
			this.finish();
		} catch (error) {
			this.fail(error);
		}
	}

	chooseDetectedSubject = async (index: number) => {
		const choices = this.host.subjectChoices;
		const subject = choices?.subjects[index];
		const photo = this.smartMaskPhoto();
		if (!choices || !subject || !photo || photo.id !== choices.photoId) return;
		this.begin(photo.id);
		const revision = ++this.sessionRevision;
		try {
			await this.ensurePrepared(photo.id);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			const componentId = entityId('component');
			const raster = await this.client!.selectInstance(photo.id, componentId, subject.box);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			const mask = createEditMask(entityId('mask'), 'subject');
			mask.name = detectedSubjectName(choices.subjects, index);
			mask.components.push({
				id: componentId,
				type: 'ai-instance',
				operation: 'add',
				label: subject.label,
				box: subject.box,
				modelVersion: this.client!.modelVersion,
				alternatives: raster.alternatives,
				raster: await this.pipeline.persistMaskRaster(photo.id, componentId, raster)
			});
			this.host.dispatchEditorCommand({ type: 'mask.create', mask });
			if (this.host.subjectChoices === choices) {
				this.host.subjectChoices = { ...choices, created: [...choices.created, index] };
			}
			this.host.selectMask(mask.id);
			this.finish();
		} catch (error) {
			this.fail(error);
		}
	};

	async createSemanticMask(kind: 'subject' | 'background' | 'sky') {
		const photo = this.smartMaskPhoto();
		if (!photo) return;
		this.begin(photo.id);
		const revision = ++this.sessionRevision;
		try {
			await this.ensurePrepared(photo.id);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			const raster =
				kind === 'sky'
					? await this.client!.selectSky(photo.id)
					: await this.client!.selectSubject(photo.id);
			if (revision !== this.sessionRevision || this.host.selectedPhoto?.id !== photo.id) return;
			const mask = createEditMask(entityId('mask'), kind);
			const componentId = entityId('component');
			mask.components.push({
				id: componentId,
				type: 'ai-subject',
				operation: 'add',
				inverted: kind === 'background',
				modelVersion: this.client!.modelVersion,
				raster: await this.pipeline.persistMaskRaster(photo.id, componentId, raster)
			});
			this.host.dispatchEditorCommand({ type: 'mask.create', mask });
			this.host.selectMask(mask.id);
			this.finish();
		} catch (error) {
			this.fail(error);
		}
	}

	preloadModels() {
		if (this.modelWarmupId !== null) return;
		const client = this.ensureClient();
		if (!client) return;
		const { id, done } = client.warmup();
		this.modelWarmupId = id;
		done.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : 'Unable to load smart mask models';
			this.host.modelPreloadStatus = {
				phase: 'error',
				progress: null,
				detail: message,
				error: message
			};
		});
	}

	fail(error: unknown) {
		this.activePhotoId = null;
		const message = error instanceof Error ? error.message : 'Smart masking failed';
		this.host.smartMaskStatus = { phase: 'error', progress: null, detail: message, error: message };
	}

	invalidateSession() {
		this.sessionRevision += 1;
		this.activePhotoId = null;
	}

	stopProgressTracking() {
		this.removeProgressListener?.();
		this.removeProgressListener = null;
	}

	destroyClient() {
		this.client?.destroy();
	}

	private smartMaskPhoto() {
		if (!this.ensureClient() || !this.host.maskStorageAvailable) {
			this.fail(new Error('Smart masking needs local browser storage'));
			return null;
		}
		if (!this.host.selectedPhoto || !this.host.canAdjustLight || !this.host.editPreview) {
			this.fail(new Error('Photo is not ready for smart masking'));
			return null;
		}
		return this.host.selectedPhoto;
	}

	private ensureClient() {
		if (this.client) return this.client;
		if (typeof Worker === 'undefined') return null;
		this.client = new SmartMaskClient();
		this.removeProgressListener = this.client.onProgress((progress) => {
			if (progress.id === this.modelWarmupId) {
				this.host.modelPreloadStatus = { ...progress, error: null };
				return;
			}
			if (!this.activePhotoId) return;
			this.host.smartMaskStatus = { ...progress, error: null };
		});
		return this.client;
	}

	private async ensurePrepared(photoId: string) {
		if (this.preparedPhotoId === photoId) return;
		if (this.preparing?.photoId === photoId) return this.preparing.promise;
		const preview = this.host.editPreview;
		if (!preview || this.host.selectedPhoto?.id !== photoId) {
			throw new Error('Photo is not ready for smart masking');
		}
		const promise = fetch(preview.src)
			.then((response) => {
				if (!response.ok) throw new Error('Unable to read the developed preview');
				return response.blob();
			})
			.then((image) => this.client!.prepare(photoId, image))
			.then(() => {
				this.preparedPhotoId = photoId;
			});
		this.preparing = { photoId, promise };
		try {
			await promise;
		} finally {
			if (this.preparing?.promise === promise) this.preparing = null;
		}
	}

	private begin(photoId: string) {
		this.activePhotoId = photoId;
		this.host.smartMaskStatus = {
			phase: 'loading',
			progress: null,
			detail: 'preparing smart mask',
			error: null
		};
	}

	private finish() {
		this.activePhotoId = null;
		this.host.smartMaskStatus = {
			phase: 'ready',
			progress: 100,
			detail: 'mask ready',
			error: null
		};
	}
}

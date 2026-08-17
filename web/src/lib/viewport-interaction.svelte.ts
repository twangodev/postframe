import { extendedStroke } from './drag-constraints.ts';
import type { EditMask, NormalizedPoint } from './edit-document.ts';
import { GizmoSession } from './gizmo-session.svelte.ts';
import type { GradientComponent } from './mask-painting.ts';
import type { MaskBrushStroke } from './mask-rasterizer.ts';
import { screenToImage, withinImage, type Point, type Size } from './photo-viewport.ts';
import type { MaskEdgeStroke } from './smart-mask.ts';
import { ViewportCamera } from './viewport-camera.svelte.ts';
import type { LivePaint } from './components/MaskPaintPreview.svelte';

export const MASK_BRUSH_FEATHER = 0.45;
export const MASK_BRUSH_FLOW = 1;

const STROKE_MIN_SPACING = 0.003;

export interface ViewportContext {
	image: () => Size;
	enabled: () => boolean;
	tool: () => string;
	selectedMask: () => EditMask | null;
	canRefineMask: () => boolean;
	smartMaskWorking: () => boolean;
	brushSize: () => number;
	maskBrushOperation: () => 'add' | 'subtract';
	refineMaskEdge: (stroke: MaskEdgeStroke) => Promise<unknown>;
	paintObjectMask: (
		points: NormalizedPoint[],
		label: 'foreground' | 'background'
	) => Promise<unknown>;
	paintBrushMask: (stroke: MaskBrushStroke, operation: 'add' | 'subtract') => Promise<unknown>;
	placeGradientComponent: (component: GradientComponent) => Promise<unknown>;
}

export class ViewportInteraction {
	private readonly context: ViewportContext;

	element = $state<HTMLDivElement | null>(null);
	spaceHeld = $state(false);
	objectStroke = $state<{
		pointerId: number;
		label: 'foreground' | 'background';
		points: NormalizedPoint[];
	} | null>(null);
	edgeRefinementStroke = $state<{
		pointerId: number;
		points: NormalizedPoint[];
		radius: number;
	} | null>(null);
	maskStroke = $state<{ pointerId: number; points: NormalizedPoint[] } | null>(null);
	brushPoint = $state<NormalizedPoint | null>(null);

	private readonly camera = new ViewportCamera(() => this.image);

	private readonly gizmos = new GizmoSession({
		image: () => this.image,
		scale: () => this.transform.scale,
		enabled: () => this.context.enabled(),
		tool: () => this.context.tool(),
		selectedMask: () => this.context.selectedMask(),
		spaceHeld: () => this.spaceHeld,
		imagePixel: (point) => this.imagePixel(point),
		capturePointer: (pointerId) => this.capturePointer(pointerId),
		adoptPointer: (pointerId, screen) => this.camera.adoptPointer(pointerId, screen),
		placeGradientComponent: (component) => this.context.placeGradientComponent(component)
	});

	constructor(context: ViewportContext) {
		this.context = context;
	}

	get image() {
		return this.context.image();
	}

	get size() {
		return this.camera.size;
	}

	get transform() {
		return this.camera.transform;
	}

	get mode() {
		return this.camera.mode;
	}

	get panning() {
		return this.camera.panning;
	}

	get imageOffset() {
		return this.camera.imageOffset;
	}

	get visiblePixels() {
		return this.camera.visiblePixels;
	}

	get pixelGridStrength() {
		return this.camera.pixelGridStrength;
	}

	get gizmoDrag() {
		return this.gizmos.drag;
	}

	get gizmoHover() {
		return this.gizmos.hover;
	}

	get settlingPaint() {
		return this.gizmos.settling;
	}

	get gizmoCursor() {
		return this.gizmos.cursor;
	}

	get gizmoComponent() {
		return this.gizmos.component;
	}

	get gizmoAngle() {
		return this.gizmos.angle;
	}

	refineBrushRadius = $derived.by(
		() =>
			this.context.brushSize() /
			2 /
			this.transform.scale /
			Math.max(this.image.width, this.image.height)
	);
	maskBrushSize = $derived(Math.min(1, this.refineBrushRadius * 2));

	livePaint: LivePaint | null = $derived.by(() => {
		if (this.gizmos.livePaint) return this.gizmos.livePaint;
		return this.maskStroke &&
			this.context.tool() === 'mask' &&
			this.context.maskBrushOperation() === 'add'
			? {
					kind: 'brush',
					points: this.maskStroke.points,
					size: this.maskBrushSize,
					feather: MASK_BRUSH_FEATHER,
					flow: MASK_BRUSH_FLOW
				}
			: null;
	});

	resize = (next: Size) => this.camera.resize(next);
	fitPhoto = () => this.camera.fitPhoto();
	showActualPixels = () => this.camera.showActualPixels();
	setZoom = (scale: number, anchor?: Point) => this.camera.setZoom(scale, anchor);
	stepZoom = (direction: -1 | 1, anchor?: Point) => this.camera.stepZoom(direction, anchor);
	zoomIn = () => this.camera.stepZoom(1);
	zoomOut = () => this.camera.stepZoom(-1);
	chooseZoom = (scale: number) => () => this.camera.setZoom(scale);

	handleWheel = (event: WheelEvent) => {
		if (!this.context.enabled()) return;
		this.camera.wheel(event, this.pointFor(event));
	};

	handlePointerDown = (event: PointerEvent) => {
		if (!this.context.enabled() || !this.element) return;
		const point = this.pointFor(event);
		if (this.gizmos.tryBegin(event, point)) return;
		const tool = this.context.tool();

		if (event.pointerType === 'touch') {
			event.preventDefault();
			this.capturePointer(event.pointerId);
			this.camera.beginTouch(event.pointerId, point);
			return;
		}

		if (tool === 'zoom' && event.button === 0) {
			event.preventDefault();
			this.camera.stepZoom(event.altKey ? -1 : 1, point);
			return;
		}

		if (tool === 'object-select' && event.button === 0) {
			const imagePoint = this.normalizedImagePoint(point);
			if (!imagePoint) return;
			event.preventDefault();
			this.capturePointer(event.pointerId);
			this.objectStroke = {
				pointerId: event.pointerId,
				label: event.altKey ? 'background' : 'foreground',
				points: [imagePoint]
			};
			return;
		}

		if (
			tool === 'mask-refine' &&
			event.button === 0 &&
			this.context.canRefineMask() &&
			!this.context.smartMaskWorking()
		) {
			const imagePoint = this.normalizedImagePoint(point);
			if (!imagePoint) return;
			event.preventDefault();
			this.capturePointer(event.pointerId);
			this.edgeRefinementStroke = {
				pointerId: event.pointerId,
				points: [imagePoint],
				radius: this.refineBrushRadius
			};
			return;
		}

		if (tool === 'mask' && event.button === 0 && this.context.selectedMask()) {
			const imagePoint = this.normalizedImagePoint(point);
			if (!imagePoint) return;
			event.preventDefault();
			this.capturePointer(event.pointerId);
			this.maskStroke = { pointerId: event.pointerId, points: [imagePoint] };
			return;
		}

		if (tool === 'hand' || this.spaceHeld || event.button === 1) {
			event.preventDefault();
			this.capturePointer(event.pointerId);
			this.camera.beginPan(event.pointerId, point);
		}
	};

	handlePointerMove = (event: PointerEvent) => {
		const point = this.pointFor(event);
		if (this.gizmos.move(event, point)) return;
		const tool = this.context.tool();
		this.brushPoint =
			(tool === 'mask-refine' || tool === 'mask') && event.pointerType !== 'touch'
				? this.normalizedImagePoint(point)
				: null;
		this.gizmos.updateHover(
			point,
			!this.panning &&
				!this.objectStroke &&
				!this.edgeRefinementStroke &&
				!this.maskStroke &&
				event.pointerType !== 'touch'
		);
		if (this.objectStroke?.pointerId === event.pointerId) {
			event.preventDefault();
			const extended = extendedStroke(
				this.objectStroke.points,
				this.normalizedImagePoint(point),
				STROKE_MIN_SPACING
			);
			if (extended) this.objectStroke = { ...this.objectStroke, points: extended };
			return;
		}
		if (this.edgeRefinementStroke?.pointerId === event.pointerId) {
			event.preventDefault();
			const extended = extendedStroke(
				this.edgeRefinementStroke.points,
				this.normalizedImagePoint(point),
				this.edgeRefinementStroke.radius / 4
			);
			if (extended) {
				this.edgeRefinementStroke = { ...this.edgeRefinementStroke, points: extended };
			}
			return;
		}
		if (this.maskStroke?.pointerId === event.pointerId) {
			event.preventDefault();
			const extended = extendedStroke(
				this.maskStroke.points,
				this.normalizedImagePoint(point),
				STROKE_MIN_SPACING
			);
			if (extended) this.maskStroke = { ...this.maskStroke, points: extended };
			return;
		}
		this.camera.movePointer(event, point);
	};

	handlePointerLeave = () => {
		this.brushPoint = null;
		this.gizmos.clearHover();
	};

	handlePointerUp = (event: PointerEvent) => {
		if (this.edgeRefinementStroke?.pointerId === event.pointerId) {
			const completed = this.edgeRefinementStroke;
			this.edgeRefinementStroke = null;
			if (event.type === 'pointerup') void this.context.refineMaskEdge(completed);
			return;
		}
		if (this.objectStroke?.pointerId === event.pointerId) {
			const completed = this.objectStroke;
			this.objectStroke = null;
			if (event.type === 'pointerup') {
				void this.context.paintObjectMask(completed.points, completed.label);
			}
			return;
		}
		if (this.maskStroke?.pointerId === event.pointerId) {
			const completed = this.maskStroke;
			this.maskStroke = null;
			if (event.type === 'pointerup') {
				void this.context.paintBrushMask(
					{
						points: completed.points,
						size: this.maskBrushSize,
						feather: MASK_BRUSH_FEATHER,
						flow: MASK_BRUSH_FLOW
					},
					this.context.maskBrushOperation()
				);
			}
			return;
		}
		if (this.gizmos.finish(event)) return;
		this.camera.releasePointer(event.pointerId);
	};

	handleDoubleClick = (event: MouseEvent) => {
		const tool = this.context.tool();
		if (
			!this.context.enabled() ||
			tool === 'zoom' ||
			tool === 'object-select' ||
			tool.startsWith('mask')
		) {
			return;
		}
		event.preventDefault();
		if (this.mode === 'fit') this.camera.setZoom(1, this.pointFor(event));
		else this.camera.fitPhoto();
	};

	handleKeyDown = (event: KeyboardEvent) => {
		if (!this.context.enabled() || editableTarget(event.target)) return;
		if (event.key === 'Escape' && this.gizmos.cancel()) {
			event.preventDefault();
			return;
		}
		if (event.code === 'Space') {
			event.preventDefault();
			this.spaceHeld = true;
			return;
		}
		if (event.key === '0') {
			event.preventDefault();
			this.camera.fitPhoto();
		} else if (event.key === '1') {
			event.preventDefault();
			this.camera.showActualPixels();
		} else if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			this.camera.stepZoom(1);
		} else if (event.key === '-' || event.key === '_') {
			event.preventDefault();
			this.camera.stepZoom(-1);
		}
	};

	handleKeyUp = (event: KeyboardEvent) => {
		if (event.code === 'Space') this.spaceHeld = false;
	};

	handleBlur = () => {
		this.spaceHeld = false;
	};

	private pointFor(event: PointerEvent | WheelEvent | MouseEvent) {
		const bounds = this.element?.getBoundingClientRect();
		if (!bounds) return { x: this.size.width / 2, y: this.size.height / 2 };
		return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
	}

	private normalizedImagePoint(point: Point) {
		const imagePoint = screenToImage(point, this.size, this.image, this.transform);
		if (!withinImage(imagePoint, this.image)) return null;
		return { x: imagePoint.x / this.image.width, y: imagePoint.y / this.image.height };
	}

	private imagePixel(point: Point): Point {
		return screenToImage(point, this.size, this.image, this.transform);
	}

	private capturePointer(pointerId: number) {
		if (!this.element) return false;
		try {
			this.element.setPointerCapture(pointerId);
			return true;
		} catch {
			// The pointer can end before capture on rapid taps; a session that
			// needs capture bails rather than wait for moves that never arrive.
			return false;
		}
	}
}

function editableTarget(target: EventTarget | null) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	);
}

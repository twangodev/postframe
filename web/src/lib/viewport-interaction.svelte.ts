import type { EditMask, NormalizedPoint } from './edit-document.ts';
import { entityId } from './entity-id.ts';
import {
	GIZMO_DRAG_THRESHOLD_PX,
	GIZMO_HIT_TOLERANCE_PX,
	GIZMO_ROTATE_OFFSET_PX,
	MIN_GRADIENT_EXTENT,
	pixelToNormalized,
	type GizmoHit
} from './mask-gizmo.ts';
import { hitTestLinear, reduceLinearDrag } from './mask-gizmo-linear.ts';
import { hitTestRadial, reduceRadialDrag } from './mask-gizmo-radial.ts';
import type { GradientComponent } from './mask-painting.ts';
import type { MaskBrushStroke } from './mask-rasterizer.ts';
import type { MaskEdgeStroke } from './smart-mask.ts';
import {
	clampTransform,
	fitScale,
	fittedTransform,
	nextZoomScale,
	panBy,
	pixelGridOpacity,
	screenToImage,
	surfaceTransform,
	visibleImageRect,
	wheelNavigation,
	zoomAt,
	type Point,
	type Size,
	type ViewportTransform
} from './photo-viewport.ts';
import type { LivePaint } from './components/MaskPaintPreview.svelte';

export const MASK_BRUSH_FEATHER = 0.45;
export const MASK_BRUSH_FLOW = 1;

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
	size = $state<Size>({ width: 1, height: 1 });
	transform = $state<ViewportTransform>({ scale: 1, pan: { x: 0, y: 0 } });
	mode = $state<'fit' | 'manual'>('fit');
	panning = $state(false);
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
	gizmoDrag = $state<{
		pointerId: number;
		start: GradientComponent;
		grip: GizmoHit;
		origin: Point;
		originScreen: Point;
		component: GradientComponent;
		moved: boolean;
	} | null>(null);
	gizmoHover = $state<GizmoHit | null>(null);
	settlingPaint = $state<LivePaint | null>(null);
	brushPoint = $state<NormalizedPoint | null>(null);

	private drag: { pointerId: number; origin: Point; transform: ViewportTransform } | null = null;
	private pinch: { origin: Point; distance: number; transform: ViewportTransform } | null = null;
	private readonly pointers = new Map<number, Point>();

	constructor(context: ViewportContext) {
		this.context = context;
	}

	get image() {
		return this.context.image();
	}

	imageOffset = $derived(surfaceTransform(this.size, this.image, this.transform));
	visiblePixels = $derived(visibleImageRect(this.size, this.image, this.transform));
	pixelGridStrength = $derived(pixelGridOpacity(this.transform.scale));
	refineBrushRadius = $derived.by(
		() =>
			this.context.brushSize() /
			2 /
			this.transform.scale /
			Math.max(this.image.width, this.image.height)
	);
	maskBrushSize = $derived(Math.min(1, this.refineBrushRadius * 2));

	private gizmoTolerance = $derived(GIZMO_HIT_TOLERANCE_PX / this.transform.scale);
	private gizmoRotateOffset = $derived(GIZMO_ROTATE_OFFSET_PX / this.transform.scale);

	gizmoCursor = $derived.by(() => {
		if (this.gizmoDrag) return 'cursor-grabbing';
		if (!this.gizmoHover) return null;
		return this.gizmoHover.kind === 'body' ? 'cursor-move' : 'cursor-grab';
	});

	private selectedGradientComponent = $derived.by(() => {
		const mask = this.context.selectedMask();
		if (!mask?.visible || (mask.kind !== 'linear' && mask.kind !== 'radial')) return null;
		return (
			mask.components.find(
				(component): component is GradientComponent => component.type === mask.kind
			) ?? null
		);
	});

	gizmoComponent = $derived.by((): GradientComponent | null => {
		if (!this.context.enabled()) return null;
		if (this.gizmoDrag?.moved) return this.gizmoDrag.component;
		return this.selectedGradientComponent;
	});

	livePaint: LivePaint | null = $derived.by(() => {
		const component = this.gizmoDrag?.moved ? this.gizmoDrag.component : null;
		if (component) return this.livePaintFor(component);
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

	private livePaintFor(component: GradientComponent): LivePaint {
		return component.type === 'linear'
			? {
					kind: 'linear',
					anchor: component.anchor,
					rotation: component.rotation,
					compression: component.compression
				}
			: {
					kind: 'radial',
					center: component.center,
					radiusX: component.radiusX,
					radiusY: component.radiusY,
					rotation: component.rotation,
					feather: component.feather
				};
	}

	resize = (next: Size) => {
		this.size = next;
		this.transform =
			this.mode === 'fit'
				? fittedTransform(next, this.image)
				: clampTransform(this.transform, next, this.image);
	};

	fitPhoto = () => {
		this.mode = 'fit';
		this.transform = fittedTransform(this.size, this.image);
	};

	showActualPixels = () => {
		this.setZoom(1);
	};

	setZoom = (scale: number, anchor = this.center()) => {
		this.mode = 'manual';
		this.transform = zoomAt(this.transform, scale, anchor, this.size, this.image);
	};

	stepZoom = (direction: -1 | 1, anchor = this.center()) => {
		this.setZoom(
			nextZoomScale(this.transform.scale, direction, fitScale(this.size, this.image)),
			anchor
		);
	};

	zoomIn = () => {
		this.stepZoom(1);
	};

	zoomOut = () => {
		this.stepZoom(-1);
	};

	chooseZoom = (scale: number) => () => this.setZoom(scale);

	handleWheel = (event: WheelEvent) => {
		if (!this.context.enabled()) return;
		event.preventDefault();
		const unit =
			event.deltaMode === WheelEvent.DOM_DELTA_LINE
				? 16
				: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
					? this.size.height
					: 1;
		const delta = { x: event.deltaX * unit, y: event.deltaY * unit };
		const navigation = wheelNavigation(delta, event);
		if (navigation.kind === 'pan') {
			this.mode = 'manual';
			this.transform = panBy(this.transform, navigation.delta, this.size, this.image);
			return;
		}
		const sensitivity = event.ctrlKey ? 0.008 : 0.0018;
		this.setZoom(
			this.transform.scale * Math.exp(-navigation.delta * sensitivity),
			this.pointFor(event)
		);
	};

	handlePointerDown = (event: PointerEvent) => {
		if (!this.context.enabled() || !this.element) return;
		if (this.tryBeginGizmoDrag(event)) return;
		const point = this.pointFor(event);
		const tool = this.context.tool();

		if (event.pointerType === 'touch') {
			event.preventDefault();
			this.capturePointer(event.pointerId);
			this.pointers.set(event.pointerId, point);
			if (this.pointers.size >= 2) this.beginPinch();
			else this.beginPan(event.pointerId, point);
			return;
		}

		if (tool === 'zoom' && event.button === 0) {
			event.preventDefault();
			this.stepZoom(event.altKey ? -1 : 1, point);
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
			this.beginPan(event.pointerId, point);
		}
	};

	private tryBeginGizmoDrag(event: PointerEvent) {
		if (event.button !== 0) return false;
		if (this.gizmoDrag) return true; // one gesture at a time; swallow extra pointers
		const point = this.pointFor(event);
		const imagePoint = this.imagePixel(point);
		const existing = this.selectedGradientComponent;
		const grabbed = existing
			? existing.type === 'linear'
				? hitTestLinear(existing, imagePoint, this.image, this.gizmoTolerance)
				: hitTestRadial(
						existing,
						imagePoint,
						this.image,
						this.gizmoTolerance,
						this.gizmoRotateOffset
					)
			: null;
		const session = grabbed
			? { component: existing!, grip: grabbed }
			: this.seedGizmoComponent(imagePoint);
		if (!session) return false;
		event.preventDefault();
		this.capturePointer(event.pointerId);
		this.gizmoDrag = {
			pointerId: event.pointerId,
			start: session.component,
			grip: session.grip,
			origin: imagePoint,
			originScreen: point,
			component: session.component,
			moved: false
		};
		this.gizmoHover = session.grip;
		return true;
	}

	private seedGizmoComponent(
		imagePoint: Point
	): { component: GradientComponent; grip: GizmoHit } | null {
		const tool = this.context.tool();
		const kind = tool === 'mask-linear' ? 'linear' : tool === 'mask-radial' ? 'radial' : null;
		const mask = this.context.selectedMask();
		if (!kind || mask?.kind !== kind) return null;
		if (
			imagePoint.x < 0 ||
			imagePoint.y < 0 ||
			imagePoint.x > this.image.width ||
			imagePoint.y > this.image.height
		) {
			return null;
		}
		const existing = mask.components.find(
			(component): component is GradientComponent => component.type === kind
		);
		const anchor = pixelToNormalized(imagePoint, this.image);
		const base = {
			id: existing?.id ?? entityId('component'),
			operation: existing?.operation ?? ('add' as const),
			raster: null
		};
		if (kind === 'linear') {
			return {
				component: {
					...base,
					type: 'linear',
					anchor,
					rotation: 0,
					compression: MIN_GRADIENT_EXTENT
				},
				grip: { kind: 'handle', handle: 'positive' }
			};
		}
		return {
			component: {
				...base,
				type: 'radial',
				center: anchor,
				radiusX: MIN_GRADIENT_EXTENT,
				radiusY: MIN_GRADIENT_EXTENT,
				rotation: 0,
				feather: existing?.type === 'radial' ? existing.feather : 0.5
			},
			grip: { kind: 'handle', handle: 'radius' }
		};
	}

	handlePointerMove = (event: PointerEvent) => {
		if (this.gizmoDrag?.pointerId === event.pointerId) {
			event.preventDefault();
			const drag = this.gizmoDrag;
			const point = this.pointFor(event);
			if (
				!drag.moved &&
				Math.hypot(point.x - drag.originScreen.x, point.y - drag.originScreen.y) <
					GIZMO_DRAG_THRESHOLD_PX
			) {
				return;
			}
			const imagePoint = this.imagePixel(point);
			const modifiers = { shift: event.shiftKey };
			const reduced =
				drag.start.type === 'linear'
					? reduceLinearDrag(drag.start, drag.grip, drag.origin, imagePoint, this.image, modifiers)
					: reduceRadialDrag(drag.start, drag.grip, drag.origin, imagePoint, this.image, modifiers);
			this.gizmoDrag = { ...drag, moved: true, component: { ...drag.start, ...reduced } };
			return;
		}
		const point = this.pointFor(event);
		const tool = this.context.tool();
		this.brushPoint =
			(tool === 'mask-refine' || tool === 'mask') && event.pointerType !== 'touch'
				? this.normalizedImagePoint(point)
				: null;
		this.gizmoHover =
			!this.gizmoDrag &&
			!this.objectStroke &&
			!this.edgeRefinementStroke &&
			!this.maskStroke &&
			event.pointerType !== 'touch' &&
			this.selectedGradientComponent
				? this.selectedGradientComponent.type === 'linear'
					? hitTestLinear(
							this.selectedGradientComponent,
							this.imagePixel(point),
							this.image,
							this.gizmoTolerance
						)
					: hitTestRadial(
							this.selectedGradientComponent,
							this.imagePixel(point),
							this.image,
							this.gizmoTolerance,
							this.gizmoRotateOffset
						)
				: null;
		if (this.objectStroke?.pointerId === event.pointerId) {
			event.preventDefault();
			const imagePoint = this.normalizedImagePoint(point);
			const previous = this.objectStroke.points.at(-1);
			if (
				imagePoint &&
				(!previous || Math.hypot(imagePoint.x - previous.x, imagePoint.y - previous.y) > 0.003)
			) {
				this.objectStroke = {
					...this.objectStroke,
					points: [...this.objectStroke.points, imagePoint]
				};
			}
			return;
		}
		if (this.edgeRefinementStroke?.pointerId === event.pointerId) {
			event.preventDefault();
			const imagePoint = this.normalizedImagePoint(point);
			const previous = this.edgeRefinementStroke.points.at(-1);
			if (
				imagePoint &&
				(!previous ||
					Math.hypot(imagePoint.x - previous.x, imagePoint.y - previous.y) >
						this.edgeRefinementStroke.radius / 4)
			) {
				this.edgeRefinementStroke = {
					...this.edgeRefinementStroke,
					points: [...this.edgeRefinementStroke.points, imagePoint]
				};
			}
			return;
		}
		if (this.maskStroke?.pointerId === event.pointerId) {
			event.preventDefault();
			const imagePoint = this.normalizedImagePoint(point);
			const previous = this.maskStroke.points.at(-1);
			if (
				imagePoint &&
				(!previous || Math.hypot(imagePoint.x - previous.x, imagePoint.y - previous.y) > 0.003)
			) {
				this.maskStroke = { ...this.maskStroke, points: [...this.maskStroke.points, imagePoint] };
			}
			return;
		}
		if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, point);

		if (this.pinch && this.pointers.size >= 2) {
			const [first, second] = [...this.pointers.values()];
			if (!first || !second) return;
			const center = midpoint(first, second);
			const scale = this.pinch.transform.scale * (distance(first, second) / this.pinch.distance);
			const zoomed = zoomAt(this.pinch.transform, scale, this.pinch.origin, this.size, this.image);
			this.mode = 'manual';
			this.transform = panBy(
				zoomed,
				{ x: center.x - this.pinch.origin.x, y: center.y - this.pinch.origin.y },
				this.size,
				this.image
			);
			return;
		}

		if (!this.drag || this.drag.pointerId !== event.pointerId) return;
		event.preventDefault();
		this.mode = 'manual';
		this.transform = panBy(
			this.drag.transform,
			{ x: point.x - this.drag.origin.x, y: point.y - this.drag.origin.y },
			this.size,
			this.image
		);
	};

	handlePointerLeave = () => {
		this.brushPoint = null;
		this.gizmoHover = null;
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
		if (this.gizmoDrag?.pointerId === event.pointerId) {
			const completed = this.gizmoDrag;
			this.gizmoDrag = null;
			if (event.type === 'pointerup' && completed.moved) {
				this.settlingPaint = this.livePaintFor(completed.component);
				void this.context
					.placeGradientComponent(completed.component)
					.finally(() =>
						requestAnimationFrame(() => requestAnimationFrame(() => (this.settlingPaint = null)))
					);
			}
			return;
		}
		const wasPinching = this.pinch !== null;
		this.pointers.delete(event.pointerId);
		if (this.drag?.pointerId === event.pointerId) this.drag = null;
		if (wasPinching && this.pointers.size === 1) {
			const [remaining] = this.pointers.entries();
			if (remaining) this.beginPan(...remaining);
		} else if (this.pointers.size < 2) {
			this.pinch = null;
		}
		this.panning = this.drag !== null || this.pinch !== null;
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
		if (this.mode === 'fit') this.setZoom(1, this.pointFor(event));
		else this.fitPhoto();
	};

	handleKeyDown = (event: KeyboardEvent) => {
		if (!this.context.enabled() || editableTarget(event.target)) return;
		if (event.key === 'Escape' && this.gizmoDrag) {
			event.preventDefault();
			this.gizmoDrag = null;
			return;
		}
		if (event.code === 'Space') {
			event.preventDefault();
			this.spaceHeld = true;
			return;
		}
		if (event.key === '0') {
			event.preventDefault();
			this.fitPhoto();
		} else if (event.key === '1') {
			event.preventDefault();
			this.showActualPixels();
		} else if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			this.stepZoom(1);
		} else if (event.key === '-' || event.key === '_') {
			event.preventDefault();
			this.stepZoom(-1);
		}
	};

	handleKeyUp = (event: KeyboardEvent) => {
		if (event.code === 'Space') this.spaceHeld = false;
	};

	handleBlur = () => {
		this.spaceHeld = false;
	};

	private center() {
		return { x: this.size.width / 2, y: this.size.height / 2 };
	}

	private pointFor(event: PointerEvent | WheelEvent | MouseEvent) {
		const bounds = this.element?.getBoundingClientRect();
		if (!bounds) return this.center();
		return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
	}

	private normalizedImagePoint(point: Point) {
		const imagePoint = screenToImage(point, this.size, this.image, this.transform);
		if (
			imagePoint.x < 0 ||
			imagePoint.y < 0 ||
			imagePoint.x > this.image.width ||
			imagePoint.y > this.image.height
		) {
			return null;
		}
		return { x: imagePoint.x / this.image.width, y: imagePoint.y / this.image.height };
	}

	private imagePixel(point: Point): Point {
		return screenToImage(point, this.size, this.image, this.transform);
	}

	private capturePointer(pointerId: number) {
		try {
			this.element?.setPointerCapture(pointerId);
		} catch {
			// The pointer can end before capture on rapid taps; the drag then
			// simply never receives moves.
		}
	}

	private beginPan(pointerId: number, origin: Point) {
		this.drag = { pointerId, origin, transform: this.transform };
		this.pinch = null;
		this.panning = true;
	}

	private beginPinch() {
		const [first, second] = [...this.pointers.values()];
		if (!first || !second) return;
		this.drag = null;
		this.pinch = {
			origin: midpoint(first, second),
			distance: Math.max(1, distance(first, second)),
			transform: this.transform
		};
		this.panning = true;
	}
}

function midpoint(first: Point, second: Point) {
	return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first: Point, second: Point) {
	return Math.hypot(second.x - first.x, second.y - first.y);
}

function editableTarget(target: EventTarget | null) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	);
}

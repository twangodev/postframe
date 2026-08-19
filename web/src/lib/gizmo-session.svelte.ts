import { rotationLabel } from './drag-constraints.ts';
import type { EditMask } from './edit-document.ts';
import {
	GIZMO_DRAG_THRESHOLD_PX,
	GIZMO_HIT_TOLERANCE_PX,
	GIZMO_ROTATE_OFFSET_PX,
	type GizmoHit
} from './mask-gizmo.ts';
import { hitTestGizmo, reduceGizmoDrag, seedGizmoComponent } from './mask-gizmo-drag.ts';
import type { GradientComponent } from './mask-painting.ts';
import type { LivePaint } from './mask-rasterizer.ts';
import type { Point, Size } from './photo-viewport.ts';

const rotationalHandles = new Set(['positive', 'negative', 'span', 'rotate']);

export interface GizmoSessionHost {
	image: () => Size;
	scale: () => number;
	enabled: () => boolean;
	tool: () => string;
	selectedMask: () => EditMask | null;
	spaceHeld: () => boolean;
	imagePixel: (point: Point) => Point;
	capturePointer: (pointerId: number) => boolean;
	adoptPointer: (pointerId: number, screen: Point) => void;
	placeGradientComponent: (component: GradientComponent) => Promise<unknown>;
}

interface GizmoDrag {
	pointerId: number;
	start: GradientComponent;
	grip: GizmoHit;
	origin: Point;
	originScreen: Point;
	screen: Point;
	component: GradientComponent;
	moved: boolean;
	snapped: boolean;
}

export class GizmoSession {
	private readonly host: GizmoSessionHost;

	drag = $state<GizmoDrag | null>(null);
	hover = $state<GizmoHit | null>(null);
	settling = $state<LivePaint | null>(null);

	constructor(host: GizmoSessionHost) {
		this.host = host;
	}

	private tolerance = $derived.by(() => GIZMO_HIT_TOLERANCE_PX / this.host.scale());
	private rotateOffset = $derived.by(() => GIZMO_ROTATE_OFFSET_PX / this.host.scale());

	cursor = $derived.by(() => {
		if (this.drag) return 'cursor-grabbing';
		if (!this.hover) return null;
		return this.hover.kind === 'body' ? 'cursor-move' : 'cursor-grab';
	});

	private selectedComponent = $derived.by(() => {
		const mask = this.host.selectedMask();
		if (!mask?.visible || (mask.kind !== 'linear' && mask.kind !== 'radial')) return null;
		return (
			mask.components.find(
				(component): component is GradientComponent => component.type === mask.kind
			) ?? null
		);
	});

	component = $derived.by((): GradientComponent | null => {
		if (!this.host.enabled()) return null;
		if (this.drag?.moved) return this.drag.component;
		return this.selectedComponent;
	});

	angle = $derived.by(() => {
		const drag = this.drag;
		if (!drag?.moved || drag.grip.kind !== 'handle') return null;
		if (!rotationalHandles.has(drag.grip.handle)) return null;
		return { label: rotationLabel(drag.component.rotation, drag.snapped), locked: drag.snapped };
	});

	livePaint = $derived.by((): LivePaint | null =>
		this.drag?.moved ? livePaintFor(this.drag.component) : null
	);

	tryBegin(event: PointerEvent, point: Point): boolean {
		if (event.button !== 0) return false;
		const active = this.drag;
		if (active && active.pointerId !== event.pointerId) {
			if (event.pointerType !== 'touch') return true; // one gesture at a time; swallow extra pointers
			this.drag = null;
			this.host.adoptPointer(active.pointerId, active.screen);
			return false;
		}
		if (active) this.drag = null;
		if (this.host.spaceHeld()) return false;
		const imagePoint = this.host.imagePixel(point);
		const existing = this.selectedComponent;
		const grabbed = existing
			? hitTestGizmo(existing, imagePoint, this.host.image(), this.tolerance, this.rotateOffset)
			: null;
		const session = grabbed
			? { component: existing!, grip: grabbed }
			: this.seedComponent(imagePoint);
		if (!session) return false;
		if (!this.host.capturePointer(event.pointerId)) return false;
		event.preventDefault();
		this.drag = {
			pointerId: event.pointerId,
			start: session.component,
			grip: session.grip,
			origin: imagePoint,
			originScreen: point,
			screen: point,
			component: session.component,
			moved: false,
			snapped: false
		};
		this.hover = session.grip;
		return true;
	}

	private seedComponent(imagePoint: Point) {
		const tool = this.host.tool();
		const kind = tool === 'mask-linear' ? 'linear' : tool === 'mask-radial' ? 'radial' : null;
		const mask = this.host.selectedMask();
		if (!kind || !mask) return null;
		return seedGizmoComponent(kind, mask, imagePoint, this.host.image());
	}

	move(event: PointerEvent, point: Point): boolean {
		const drag = this.drag;
		if (drag?.pointerId !== event.pointerId) return false;
		event.preventDefault();
		if (
			!drag.moved &&
			Math.hypot(point.x - drag.originScreen.x, point.y - drag.originScreen.y) <
				GIZMO_DRAG_THRESHOLD_PX
		) {
			return true;
		}
		const modifiers = { shift: event.shiftKey };
		this.drag = {
			...drag,
			moved: true,
			screen: point,
			component: reduceGizmoDrag(
				drag.start,
				drag.grip,
				drag.origin,
				this.host.imagePixel(point),
				this.host.image(),
				modifiers
			),
			snapped: modifiers.shift
		};
		return true;
	}

	updateHover(point: Point, eligible: boolean) {
		this.hover =
			!this.drag && eligible && this.selectedComponent
				? hitTestGizmo(
						this.selectedComponent,
						this.host.imagePixel(point),
						this.host.image(),
						this.tolerance,
						this.rotateOffset
					)
				: null;
	}

	clearHover() {
		this.hover = null;
	}

	finish(event: PointerEvent): boolean {
		const completed = this.drag;
		if (completed?.pointerId !== event.pointerId) return false;
		this.drag = null;
		if (event.type === 'pointerup' && completed.moved) {
			this.settling = livePaintFor(completed.component);
			void this.host
				.placeGradientComponent(completed.component)
				.finally(() =>
					requestAnimationFrame(() => requestAnimationFrame(() => (this.settling = null)))
				);
		}
		return true;
	}

	cancel(): boolean {
		if (!this.drag) return false;
		this.drag = null;
		return true;
	}
}

function livePaintFor(component: GradientComponent): LivePaint {
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

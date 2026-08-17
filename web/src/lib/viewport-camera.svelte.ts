import {
	clampTransform,
	fitScale,
	fittedTransform,
	nextZoomScale,
	panBy,
	pixelGridOpacity,
	surfaceTransform,
	visibleImageRect,
	wheelNavigation,
	zoomAt,
	type Point,
	type Size,
	type ViewportTransform
} from './photo-viewport.ts';

export class ViewportCamera {
	private readonly image: () => Size;

	size = $state<Size>({ width: 1, height: 1 });
	transform = $state<ViewportTransform>({ scale: 1, pan: { x: 0, y: 0 } });
	mode = $state<'fit' | 'manual'>('fit');
	panning = $state(false);

	private drag: { pointerId: number; origin: Point; transform: ViewportTransform } | null = null;
	private pinch: { origin: Point; distance: number; transform: ViewportTransform } | null = null;
	private readonly pointers = new Map<number, Point>();

	constructor(image: () => Size) {
		this.image = image;
	}

	imageOffset = $derived.by(() => surfaceTransform(this.size, this.image(), this.transform));
	visiblePixels = $derived.by(() => visibleImageRect(this.size, this.image(), this.transform));
	pixelGridStrength = $derived(pixelGridOpacity(this.transform.scale));

	resize(next: Size) {
		this.size = next;
		this.transform =
			this.mode === 'fit'
				? fittedTransform(next, this.image())
				: clampTransform(this.transform, next, this.image());
	}

	fitPhoto() {
		this.mode = 'fit';
		this.transform = fittedTransform(this.size, this.image());
	}

	showActualPixels() {
		this.setZoom(1);
	}

	setZoom(scale: number, anchor = this.center()) {
		this.mode = 'manual';
		this.transform = zoomAt(this.transform, scale, anchor, this.size, this.image());
	}

	stepZoom(direction: -1 | 1, anchor = this.center()) {
		this.setZoom(
			nextZoomScale(this.transform.scale, direction, fitScale(this.size, this.image())),
			anchor
		);
	}

	wheel(event: WheelEvent, anchor: Point) {
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
			this.transform = panBy(this.transform, navigation.delta, this.size, this.image());
			return;
		}
		const sensitivity = event.ctrlKey ? 0.008 : 0.0018;
		this.setZoom(this.transform.scale * Math.exp(-navigation.delta * sensitivity), anchor);
	}

	beginPan(pointerId: number, origin: Point) {
		this.drag = { pointerId, origin, transform: this.transform };
		this.pinch = null;
		this.panning = true;
	}

	beginTouch(pointerId: number, point: Point) {
		this.pointers.set(pointerId, point);
		if (this.pointers.size >= 2) this.beginPinch();
		else this.beginPan(pointerId, point);
	}

	adoptPointer(pointerId: number, point: Point) {
		this.pointers.set(pointerId, point);
	}

	movePointer(event: PointerEvent, point: Point) {
		if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, point);

		if (this.pinch && this.pointers.size >= 2) {
			const [first, second] = [...this.pointers.values()];
			if (!first || !second) return;
			const center = midpoint(first, second);
			const scale = this.pinch.transform.scale * (distance(first, second) / this.pinch.distance);
			const zoomed = zoomAt(
				this.pinch.transform,
				scale,
				this.pinch.origin,
				this.size,
				this.image()
			);
			this.mode = 'manual';
			this.transform = panBy(
				zoomed,
				{ x: center.x - this.pinch.origin.x, y: center.y - this.pinch.origin.y },
				this.size,
				this.image()
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
			this.image()
		);
	}

	releasePointer(pointerId: number) {
		const wasPinching = this.pinch !== null;
		this.pointers.delete(pointerId);
		if (this.drag?.pointerId === pointerId) this.drag = null;
		if (wasPinching && this.pointers.size === 1) {
			const [remaining] = this.pointers.entries();
			if (remaining) this.beginPan(...remaining);
		} else if (this.pointers.size < 2) {
			this.pinch = null;
		}
		this.panning = this.drag !== null || this.pinch !== null;
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

	private center() {
		return { x: this.size.width / 2, y: this.size.height / 2 };
	}
}

function midpoint(first: Point, second: Point) {
	return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first: Point, second: Point) {
	return Math.hypot(second.x - first.x, second.y - first.y);
}

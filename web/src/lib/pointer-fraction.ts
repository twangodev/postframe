/** The pointer's position as fractions of the element's box, 0..1 inside it. */
export function pointerFraction(event: PointerEvent, element: Element): { x: number; y: number } {
	const bounds = element.getBoundingClientRect();
	return {
		x: (event.clientX - bounds.left) / bounds.width,
		y: (event.clientY - bounds.top) / bounds.height
	};
}

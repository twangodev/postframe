import { clampExtent, maxDimension, type LinearGizmoGeometry } from '../src/lib/mask-gizmo.ts';
import type { Size } from '../src/lib/photo-viewport.ts';

export function linearGeometryFromSpan(
	start: { x: number; y: number },
	end: { x: number; y: number },
	aspect: Size
): LinearGizmoGeometry {
	const maxDim = maxDimension(aspect);
	const axis = {
		x: ((end.x - start.x) * aspect.width) / maxDim,
		y: ((end.y - start.y) * aspect.height) / maxDim
	};
	const length = Math.hypot(axis.x, axis.y);
	return {
		anchor: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
		rotation: length === 0 ? 0 : Math.atan2(axis.y, axis.x),
		compression: clampExtent(length / 2)
	};
}

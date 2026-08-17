/// Geometry of a grading wheel: a unit disc whose angle is the hue, clockwise
/// from the top, and whose radius is the saturation.
export interface DiscPoint {
	x: number;
	y: number;
}

export interface WheelPosition {
	hue: number;
	saturation: number;
}

export function hueSaturationToPoint(hue: number, saturation: number): DiscPoint {
	const radians = (hue * Math.PI) / 180;
	const radius = Math.min(100, Math.max(0, saturation)) / 100;
	return { x: Math.sin(radians) * radius, y: -Math.cos(radians) * radius };
}

export function pointToHueSaturation({ x, y }: DiscPoint): WheelPosition {
	const degrees = (Math.atan2(x, -y) * 180) / Math.PI;
	return {
		hue: degrees - Math.floor(degrees / 360) * 360,
		saturation: Math.min(1, Math.hypot(x, y)) * 100
	};
}

export function clampToDisc(point: DiscPoint): DiscPoint {
	const radius = Math.hypot(point.x, point.y);
	if (radius <= 1) return point;
	return { x: point.x / radius, y: point.y / radius };
}

export interface AdjustmentFormat {
	signed: boolean;
	decimals?: number;
	suffix?: string;
}

/// Fixed decimals pad like a slider readout; otherwise it trims to at most two, like a history label.
export function formatAdjustment(
	value: number,
	{ signed, decimals, suffix = '' }: AdjustmentFormat
): string {
	const sign = signed && value > 0 ? '+' : '';
	return `${sign}${formattedNumber(value, decimals)}${suffix}`;
}

function formattedNumber(value: number, decimals?: number) {
	if (decimals !== undefined) return value.toFixed(decimals);
	return Number.isInteger(value)
		? String(value)
		: value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

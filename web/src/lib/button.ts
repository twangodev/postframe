export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

const SURFACES: Record<ButtonVariant, string> = {
	primary: 'bg-text text-bg transition-opacity',
	secondary: 'border border-subtle text-muted transition-colors hover:bg-surface hover:text-text',
	destructive: 'bg-negative text-bg transition-opacity'
};

const DISABLED: Record<ButtonVariant, string> = {
	primary: 'disabled:opacity-35',
	secondary: 'disabled:opacity-40',
	destructive: 'disabled:opacity-45'
};

export function buttonClass(variant: ButtonVariant, options: { busy?: boolean } = {}): string {
	const cursor = options.busy ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed';
	return `cursor-pointer rounded px-3 py-2 text-[11px] ${SURFACES[variant]} ${cursor} ${DISABLED[variant]}`;
}

export const primaryButtonClass = buttonClass('primary');
export const secondaryButtonClass = buttonClass('secondary');
export const destructiveButtonClass = buttonClass('destructive');

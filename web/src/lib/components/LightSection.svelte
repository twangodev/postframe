<script lang="ts">
	import AdjustmentSliders from './ui/AdjustmentSliders.svelte';
	import Panel from './ui/Panel.svelte';
	import type { ControlRevealPhase } from '$lib/adjustment-reveal';
	import type { LightControlName } from '$lib/develop-settings';
	import { LIGHT_SLIDERS, slidersForControls } from '$lib/develop-sliders';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		open?: boolean;
		reveals?: Partial<Record<LightControlName, ControlRevealPhase>>;
		onRevealInteraction?: (control: LightControlName) => void;
		disabled?: boolean;
		focused?: boolean;
		controls?: readonly LightControlName[];
	}

	let {
		workspace,
		open = $bindable(true),
		reveals = {},
		onRevealInteraction = () => {},
		disabled = false,
		focused = false,
		controls
	}: Props = $props();
	const sliders = $derived(slidersForControls(LIGHT_SLIDERS, controls));
	const controlsDisabled = $derived(disabled || !workspace.canAdjustLight);
</script>

<Panel title="Light" bind:open>
	{#if !focused}
		<button
			type="button"
			aria-label="Auto tone"
			disabled={controlsDisabled}
			onclick={() => void workspace.autoTone()}
			class="mb-3 flex h-6 w-full cursor-pointer items-center justify-center rounded border border-subtle text-[11px] text-muted lowercase transition-colors hover:text-text disabled:cursor-default disabled:opacity-40"
		>
			auto
		</button>
	{/if}
	<AdjustmentSliders
		{sliders}
		values={workspace.adjustments}
		disabled={controlsDisabled}
		{reveals}
		{onRevealInteraction}
		onPreview={(control, value) => workspace.previewAdjustment('light', control, value)}
		onCommit={(control, value) => workspace.commitAdjustment('light', control, value)}
	/>
</Panel>

<script lang="ts">
	import { Pipette, SlidersHorizontal } from '@lucide/svelte';
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import AdjustmentSliders from './ui/AdjustmentSliders.svelte';
	import Panel from './ui/Panel.svelte';
	import { COLOR_SLIDERS } from '$lib/develop-sliders';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		activeTool: string;
		onPickTool: (tool: string) => void;
		onOpenMixer: () => void;
	}

	let { workspace, activeTool, onPickTool, onOpenMixer }: Props = $props();

	const eyedropperActive = $derived(activeTool === 'eyedropper');
</script>

<Panel title="Color">
	<div class="mb-3 flex gap-1">
		<button
			type="button"
			aria-label="Auto white balance"
			disabled={!workspace.canAdjustLight}
			onclick={() => void workspace.autoWhiteBalance()}
			class="h-6 flex-1 cursor-pointer rounded border border-subtle text-[11px] text-muted lowercase transition-colors hover:text-text disabled:cursor-default disabled:opacity-40"
		>
			auto
		</button>
		<button
			type="button"
			aria-label="White balance eyedropper"
			aria-pressed={eyedropperActive}
			disabled={!workspace.canAdjustLight}
			onclick={() => onPickTool('eyedropper')}
			class="flex h-6 flex-1 cursor-pointer items-center justify-center rounded border transition-colors disabled:cursor-default disabled:opacity-40 {eyedropperActive
				? 'border-control-edge bg-surface text-text'
				: 'border-subtle text-muted hover:text-text'}"
		>
			<Pipette size={12} strokeWidth={1.6} />
		</button>
	</div>
	<AdjustmentSliders
		sliders={COLOR_SLIDERS}
		values={workspace.adjustments}
		disabled={!workspace.canAdjustLight}
		onPreview={(control, value) => workspace.previewAdjustment('color', control, value)}
		onCommit={(control, value) => workspace.commitAdjustment('color', control, value)}
	/>
	{#if workspace.hasCameraLook}
		<div class="mt-3 border-t border-subtle pt-3">
			<AdjustmentSlider
				label="camera look"
				value={workspace.cameraLook}
				min={0}
				max={100}
				step={1}
				defaultValue={100}
				signed={false}
				suffix="%"
				disabled={!workspace.canAdjustLight}
				onValueCommit={(value) => workspace.setCameraLook(value)}
			/>
		</div>
	{/if}
	<button
		type="button"
		aria-label="open color mixer"
		onclick={onOpenMixer}
		class="mt-2 flex w-full cursor-pointer items-center justify-between rounded border border-subtle px-2 py-2 text-[11px] text-muted hover:text-text"
	>
		color mixer <SlidersHorizontal size={12} />
	</button>
</Panel>

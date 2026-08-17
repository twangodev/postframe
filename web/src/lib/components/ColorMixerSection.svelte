<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import {
		MIXER_BAND_CONTROL_NAMES,
		MIXER_BAND_NAMES,
		type MixerBandControlName,
		type MixerBandName
	} from '$lib/develop-settings';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		open?: boolean;
	}

	let { workspace, open = $bindable(false) }: Props = $props();

	const SWATCH_HUES: Record<MixerBandName, number> = {
		red: 0,
		orange: 30,
		yellow: 60,
		green: 120,
		aqua: 180,
		blue: 240,
		purple: 280,
		magenta: 320
	};

	let band = $state<MixerBandName>('red');

	const moved = (name: MixerBandName) =>
		MIXER_BAND_CONTROL_NAMES.some((control) => workspace.mixer[name][control] !== 0);

	const target = (control: MixerBandControlName) => ({ group: 'mixer', band, control }) as const;
	const preview = (control: MixerBandControlName) => (value: number) =>
		workspace.previewAdjustmentAt(target(control), value);
	const commit = (control: MixerBandControlName) => (value: number) =>
		workspace.commitAdjustmentAt(target(control), value);
</script>

<Panel title="Color mixer" bind:open>
	<div class="mb-2 flex gap-1" role="radiogroup" aria-label="Mixer band">
		{#each MIXER_BAND_NAMES as name (name)}
			<button
				type="button"
				role="radio"
				aria-checked={band === name}
				aria-label={name}
				title={name}
				onclick={() => (band = name)}
				class="h-6 flex-1 cursor-pointer rounded border transition-colors {band === name
					? 'border-control-active'
					: 'border-transparent hover:border-muted'}"
				style="background-color: hsl({SWATCH_HUES[name]} 62% 46%)"
			>
				<span
					class="mx-auto block size-1 rounded-full bg-bg transition-opacity"
					class:opacity-0={!moved(name)}
				></span>
			</button>
		{/each}
	</div>
	{#each MIXER_BAND_CONTROL_NAMES as control (control)}
		<AdjustmentSlider
			label={control}
			bind:value={workspace.mixer[band][control]}
			min={-100}
			max={100}
			disabled={!workspace.canAdjustLight}
			onValueChange={preview(control)}
			onValueCommit={commit(control)}
		/>
	{/each}
</Panel>

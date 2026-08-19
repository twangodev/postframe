<script lang="ts">
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import Panel from './ui/Panel.svelte';
	import SegmentedControl from './ui/SegmentedControl.svelte';
	import {
		MIXER_BAND_CONTROL_NAMES,
		MIXER_BAND_NAMES,
		type MixerBandControlName,
		type MixerBandName
	} from '$lib/develop-settings';
	import type { DevelopBinding } from '$lib/develop-binding';

	interface Props {
		binding: DevelopBinding;
		open?: boolean;
	}

	let { binding, open = $bindable(false) }: Props = $props();

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
		MIXER_BAND_CONTROL_NAMES.some((control) => binding.mixer[name][control] !== 0);

	const target = (control: MixerBandControlName) => ({ group: 'mixer', band, control }) as const;
	const preview = (control: MixerBandControlName) => (value: number) =>
		binding.previewAdjustmentAt(target(control), value);
	const commit = (control: MixerBandControlName) => (value: number) =>
		binding.commitAdjustmentAt(target(control), value);
</script>

{#snippet bandDot(name: MixerBandName)}
	<span
		class="mx-auto block size-1 rounded-full bg-bg transition-opacity"
		class:opacity-0={!moved(name)}
	></span>
{/snippet}

<Panel title="Color mixer" bind:open>
	<SegmentedControl
		options={MIXER_BAND_NAMES}
		bind:value={band}
		label="Mixer band"
		class="mb-2"
		itemClass="border-transparent hover:border-muted data-[state=on]:border-control-active"
		itemStyle={(name) => `background-color: hsl(${SWATCH_HUES[name]} 62% 46%)`}
		itemTitle={(name) => name}
		item={bandDot}
	/>
	{#each MIXER_BAND_CONTROL_NAMES as control (control)}
		<AdjustmentSlider
			label={`Band ${control}`}
			bind:value={binding.mixer[band][control]}
			min={-100}
			max={100}
			disabled={binding.disabled}
			onValueChange={preview(control)}
			onValueCommit={commit(control)}
		/>
	{/each}
</Panel>

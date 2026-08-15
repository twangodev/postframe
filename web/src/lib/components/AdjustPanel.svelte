<script lang="ts">
	import { Tabs } from 'bits-ui';
	import { History, SlidersHorizontal, Sparkles } from '@lucide/svelte';
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import ImageScope from './ui/ImageScope.svelte';
	import Panel from './ui/Panel.svelte';
	import type { LightControlName } from '$lib/develop-settings';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const previewLight = (control: LightControlName) => (value: number) =>
		workspace.previewLight(control, value);
	const commitLight = (control: LightControlName) => (value: number) =>
		workspace.commitLight(control, value);
</script>

<Tabs.Content value="adjust" class="motion-tab">
	<div class="border-subtle border-b p-3">
		<ImageScope data={workspace.imageScope} loading={workspace.documentStatus.kind === 'loading'} />
	</div>

	<Panel title="Profile" meta="Camera look">
		<button
			type="button"
			class="border-subtle bg-surface text-text/80 hover:border-muted flex h-8 w-full cursor-pointer items-center justify-between rounded border px-2 text-[12px]"
		>
			<span>camera standard</span><span class="text-muted font-mono text-[11px]">PF</span>
		</button>
	</Panel>

	<Panel title="Light">
		<AdjustmentSlider
			label="Exposure"
			bind:value={workspace.adjustments.exposure}
			min={-4}
			max={4}
			step={0.05}
			decimals={2}
			suffix=" EV"
			disabled={!workspace.canAdjustLight}
			onValueChange={previewLight('exposure')}
			onValueCommit={commitLight('exposure')}
		/>
		<AdjustmentSlider
			label="Contrast"
			bind:value={workspace.adjustments.contrast}
			min={-100}
			max={100}
			disabled={!workspace.canAdjustLight}
			onValueChange={previewLight('contrast')}
			onValueCommit={commitLight('contrast')}
		/>
		<AdjustmentSlider
			label="Highlights"
			bind:value={workspace.adjustments.highlights}
			min={-100}
			max={100}
			disabled={!workspace.canAdjustLight}
			onValueChange={previewLight('highlights')}
			onValueCommit={commitLight('highlights')}
		/>
		<AdjustmentSlider
			label="Shadows"
			bind:value={workspace.adjustments.shadows}
			min={-100}
			max={100}
			disabled={!workspace.canAdjustLight}
			onValueChange={previewLight('shadows')}
			onValueCommit={commitLight('shadows')}
		/>
		<AdjustmentSlider
			label="Whites"
			bind:value={workspace.adjustments.whites}
			min={-100}
			max={100}
			disabled={!workspace.canAdjustLight}
			onValueChange={previewLight('whites')}
			onValueCommit={commitLight('whites')}
		/>
		<AdjustmentSlider
			label="Blacks"
			bind:value={workspace.adjustments.blacks}
			min={-100}
			max={100}
			disabled={!workspace.canAdjustLight}
			onValueChange={previewLight('blacks')}
			onValueCommit={commitLight('blacks')}
		/>
	</Panel>

	<Panel title="Color">
		<AdjustmentSlider
			label="Temperature"
			bind:value={workspace.adjustments.temperature}
			min={2000}
			max={12000}
			step={50}
			defaultValue={5600}
			suffix="K"
			signed={false}
		/>
		<AdjustmentSlider label="Tint" bind:value={workspace.adjustments.tint} min={-150} max={150} />
		<AdjustmentSlider
			label="Vibrance"
			bind:value={workspace.adjustments.vibrance}
			min={-100}
			max={100}
		/>
		<AdjustmentSlider
			label="Saturation"
			bind:value={workspace.adjustments.saturation}
			min={-100}
			max={100}
		/>
		<button
			type="button"
			class="border-subtle text-muted hover:text-text mt-2 flex w-full cursor-pointer items-center justify-between rounded border px-2 py-2 text-[11px]"
		>
			color mixer <SlidersHorizontal size={12} />
		</button>
	</Panel>

	<Panel title="Presence" open={false}>
		<AdjustmentSlider
			label="Texture"
			bind:value={workspace.adjustments.texture}
			min={-100}
			max={100}
		/>
		<AdjustmentSlider
			label="Clarity"
			bind:value={workspace.adjustments.clarity}
			min={-100}
			max={100}
		/>
		<AdjustmentSlider
			label="Dehaze"
			bind:value={workspace.adjustments.dehaze}
			min={-100}
			max={100}
		/>
	</Panel>

	<Panel title="Detail" open={false}>
		<AdjustmentSlider
			label="Sharpening"
			bind:value={workspace.adjustments.sharpening}
			min={0}
			max={100}
			defaultValue={40}
			signed={false}
		/>
		<AdjustmentSlider
			label="Noise reduction"
			bind:value={workspace.adjustments.noiseReduction}
			min={0}
			max={100}
			defaultValue={10}
			signed={false}
		/>
	</Panel>

	<Panel title="Optics" open={false}>
		<label class="text-muted flex cursor-pointer items-center gap-2 py-1 text-[11px]">
			<input type="checkbox" checked class="accent-accent" /> remove chromatic aberration
		</label>
		<label class="text-muted flex cursor-pointer items-center gap-2 py-1 text-[11px]">
			<input type="checkbox" checked class="accent-accent" /> use lens profile
		</label>
	</Panel>

	<Panel title="Presets" open={false}>
		<div class="space-y-1">
			{#each ['Clean color', 'Soft highlight', 'Neutral portrait', 'Cinematic dusk'] as preset}
				<button
					type="button"
					class="text-muted hover:bg-surface hover:text-text flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] lowercase"
				>
					<Sparkles size={11} />
					{preset}
				</button>
			{/each}
		</div>
	</Panel>

	<Panel title="History" open={false} meta={`${workspace.history.length}`}>
		<div class="border-subtle space-y-2 border-l pl-3">
			{#each [...workspace.history].reverse() as item, index}
				<div
					class="flex items-center gap-2 text-[11px] lowercase {index === 0
						? 'text-text'
						: 'text-muted'}"
				>
					<History size={10} />
					{item}
				</div>
			{/each}
		</div>
	</Panel>
</Tabs.Content>

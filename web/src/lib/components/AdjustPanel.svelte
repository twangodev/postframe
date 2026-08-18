<script lang="ts">
	import { Tabs } from 'bits-ui';
	import { History } from '@lucide/svelte';
	import ColorMixerSection from './ColorMixerSection.svelte';
	import ColorSection from './ColorSection.svelte';
	import DetailSection from './DetailSection.svelte';
	import EffectsSection from './EffectsSection.svelte';
	import GradingSection from './GradingSection.svelte';
	import LightSection from './LightSection.svelte';
	import PresetsSection from './PresetsSection.svelte';
	import ToneCurveSection from './ToneCurveSection.svelte';
	import ImageScope from './ui/ImageScope.svelte';
	import Panel from './ui/Panel.svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	let mixerOpen = $state(false);
</script>

<Tabs.Content value="adjust" class="motion-tab">
	<div class="border-b border-subtle p-3">
		<ImageScope data={workspace.imageScope} loading={workspace.documentStatus.kind === 'loading'} />
	</div>

	<Panel title="Profile" meta="Camera look">
		<button
			type="button"
			class="flex h-8 w-full cursor-pointer items-center justify-between rounded border border-subtle bg-surface px-2 text-[12px] text-text/80 hover:border-muted"
		>
			<span>camera standard</span><span class="font-mono text-[11px] text-muted">PF</span>
		</button>
	</Panel>

	<LightSection {workspace} />
	<ToneCurveSection {workspace} />
	<ColorSection {workspace} onOpenMixer={() => (mixerOpen = true)} />
	<ColorMixerSection {workspace} bind:open={mixerOpen} />
	<GradingSection {workspace} />
	<DetailSection {workspace} />
	<EffectsSection {workspace} />

	<Panel title="Optics" open={false}>
		<label class="flex cursor-pointer items-center gap-2 py-1 text-[11px] text-muted">
			<input type="checkbox" checked class="accent-accent" /> remove chromatic aberration
		</label>
		<label class="flex cursor-pointer items-center gap-2 py-1 text-[11px] text-muted">
			<input type="checkbox" checked class="accent-accent" /> use lens profile
		</label>
	</Panel>

	<PresetsSection {workspace} />

	<Panel title="History" open={false} meta={`${workspace.history.length}`}>
		<div class="space-y-2 border-l border-subtle pl-3">
			{#each [...workspace.history].reverse() as item, index (index)}
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

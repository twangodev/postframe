<script lang="ts">
	import { Save, Sparkles, X } from '@lucide/svelte';
	import IconButton from './ui/IconButton.svelte';
	import Panel from './ui/Panel.svelte';
	import SettingsGroupDialog from './SettingsGroupDialog.svelte';
	import { presetNamed } from '$lib/preset';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	let saveOpen = $state(false);

	const meta = $derived(workspace.presets.length > 0 ? `${workspace.presets.length}` : undefined);

	const groupCount = (count: number) => `${count} group${count === 1 ? '' : 's'}`;
	const saveLabel = (name: string) =>
		presetNamed(workspace.presets, name) ? 'update preset' : 'save preset';
</script>

<Panel title="Presets" open={false} {meta}>
	<div class="space-y-1">
		{#each workspace.presets as preset (preset.id)}
			<div class="flex items-center gap-1">
				<button
					type="button"
					disabled={!workspace.canAdjustLight}
					onclick={() => workspace.applyPreset(preset.id)}
					class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-muted hover:bg-surface hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
				>
					<Sparkles size={11} class="shrink-0" />
					<span class="min-w-0 flex-1 truncate">{preset.name}</span>
					<span class="shrink-0 font-mono text-[10px] text-muted"
						>{groupCount(preset.groups.length)}</span
					>
				</button>
				<IconButton
					label={`Delete preset ${preset.name}`}
					tooltip="delete preset"
					class="shrink-0"
					onclick={() => workspace.deletePreset(preset.id)}
				>
					<X size={11} />
				</IconButton>
			</div>
		{:else}
			<p class="px-2 py-1.5 text-[11px] text-muted">no presets yet</p>
		{/each}
	</div>
	<button
		type="button"
		disabled={!workspace.canAdjustLight}
		onclick={() => (saveOpen = true)}
		class="mt-2 flex w-full cursor-pointer items-center justify-between rounded border border-subtle px-2 py-2 text-[11px] text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
	>
		save current… <Save size={12} />
	</button>
</Panel>

<SettingsGroupDialog
	bind:open={saveOpen}
	title="save preset"
	description="the chosen settings of this photograph, kept in your library."
	confirmLabel={saveLabel}
	groups={workspace.editedGroups}
	name={{ value: '', label: 'preset name' }}
	onConfirm={(groups, name) => workspace.savePreset(name ?? '', groups)}
/>

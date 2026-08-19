<script lang="ts">
	import { Camera, History, X } from '@lucide/svelte';
	import IconButton from './ui/IconButton.svelte';
	import Panel from './ui/Panel.svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	let naming = $state(false);
	let name = $state('');
	let field = $state<HTMLInputElement | null>(null);

	const meta = $derived(
		workspace.snapshots.length > 0 ? `${workspace.snapshots.length}` : undefined
	);

	function startNaming() {
		name = `snapshot ${workspace.snapshots.length + 1}`;
		naming = true;
	}

	function save() {
		workspace.saveSnapshot(name);
		naming = false;
	}

	function handleKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			save();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			naming = false;
		}
	}

	$effect(() => {
		if (naming) field?.select();
	});
</script>

<Panel title="Snapshots" open={false} {meta}>
	<div class="space-y-1">
		{#each workspace.snapshots as snapshot (snapshot.id)}
			<div class="flex items-center gap-1">
				<button
					type="button"
					disabled={!workspace.canAdjustLight}
					onclick={() => workspace.applySnapshot(snapshot.id)}
					class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-muted hover:bg-surface hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
				>
					<History size={11} class="shrink-0" />
					<span class="min-w-0 flex-1 truncate">{snapshot.name}</span>
				</button>
				<IconButton
					label={`Delete snapshot ${snapshot.name}`}
					tooltip="delete snapshot"
					class="shrink-0"
					onclick={() => workspace.deleteSnapshot(snapshot.id)}
				>
					<X size={11} />
				</IconButton>
			</div>
		{:else}
			<p class="px-2 py-1.5 text-[11px] text-muted">no snapshots yet</p>
		{/each}
	</div>
	{#if naming}
		<div class="mt-2 flex items-center gap-1">
			<input
				bind:this={field}
				bind:value={name}
				type="text"
				spellcheck="false"
				aria-label="Snapshot name"
				onkeydown={handleKey}
				onblur={() => (naming = false)}
				class="h-7 min-w-0 flex-1 rounded border border-control-edge bg-surface px-2 text-[11px] text-text outline-none"
			/>
		</div>
	{:else}
		<button
			type="button"
			disabled={!workspace.canAdjustLight}
			onclick={startNaming}
			class="mt-2 flex w-full cursor-pointer items-center justify-between rounded border border-subtle px-2 py-2 text-[11px] text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
		>
			save this state… <Camera size={12} />
		</button>
	{/if}
</Panel>

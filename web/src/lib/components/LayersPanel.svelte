<script lang="ts">
	import { Tabs } from 'bits-ui';
	import { CircleDashed, Eye, EyeOff, Lock, SlidersHorizontal } from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const active = $derived(workspace.editingPhoto);
</script>

<Tabs.Content value="layers" class="motion-tab">
	<div class="space-y-1 p-2">
		{#if workspace.hasCameraLook}
			<div class="rounded border border-accent bg-surface px-2 py-2">
				<div class="flex items-center gap-2">
					<button
						type="button"
						aria-label={workspace.cameraLookEnabled ? 'Hide camera look' : 'Show camera look'}
						aria-pressed={workspace.cameraLookEnabled}
						disabled={!workspace.canAdjustLight}
						onclick={workspace.toggleCameraLook}
						class="cursor-pointer text-muted hover:text-text disabled:cursor-default disabled:opacity-40"
					>
						{#if workspace.cameraLookEnabled}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
					</button>
					<div
						class="flex size-7 shrink-0 items-center justify-center rounded-sm bg-elevated text-muted"
					>
						<SlidersHorizontal size={12} />
					</div>
					<span class="min-w-0 flex-1 truncate text-[11px]">camera look</span>
					<span class="font-mono text-[10px] text-muted">{Math.round(workspace.cameraLook)}%</span>
				</div>
				<input
					type="range"
					aria-label="Camera look amount"
					min="0"
					max="100"
					step="1"
					value={workspace.cameraLook}
					disabled={!workspace.canAdjustLight || !workspace.cameraLookEnabled}
					onchange={(event) => workspace.setCameraLook(event.currentTarget.valueAsNumber)}
					class="mt-1 h-3 w-full cursor-pointer accent-accent disabled:cursor-default disabled:opacity-40"
				/>
			</div>
		{/if}

		{#each workspace.masks as mask (mask.id)}
			<div class="flex h-10 items-center gap-2 rounded border border-subtle px-2">
				{#if mask.visible}<Eye size={12} class="shrink-0 text-muted" />{:else}<EyeOff
						size={12}
						class="shrink-0 text-muted"
					/>{/if}
				<div
					class="flex size-7 shrink-0 items-center justify-center rounded-sm bg-elevated text-muted"
				>
					<CircleDashed size={12} />
				</div>
				<span class="min-w-0 flex-1 truncate text-[11px]">{mask.name}</span>
			</div>
		{/each}

		<div class="flex h-11 items-center gap-2 rounded border border-subtle px-2">
			<Eye size={12} class="shrink-0 text-muted" />
			<div class="size-7 shrink-0 overflow-hidden rounded-sm bg-canvas">
				{#if active}<PhotoVisual photo={active} onRequest={workspace.loadThumbnail} />{/if}
			</div>
			<span class="min-w-0 flex-1 truncate font-mono text-[11px]">
				{active?.name ?? 'photograph'}
			</span>
			<Lock size={11} class="text-muted" />
		</div>
	</div>
</Tabs.Content>

<script lang="ts">
	import { Tabs } from 'bits-ui';
	import {
		CircleDashed,
		Eye,
		EyeOff,
		Lock,
		MoreHorizontal,
		Plus,
		SlidersHorizontal,
		Trash2
	} from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const active = $derived(workspace.editingPhoto);
</script>

<Tabs.Content value="layers" class="motion-tab">
	<!-- TODO(WASM_TODOS.layersAndHistory): back this panel with document layers and history. -->
	<div class="flex items-center gap-2 border-b border-subtle p-2">
		<select
			aria-label="Layer blend mode"
			class="h-7 min-w-0 flex-1 cursor-pointer rounded border border-subtle bg-surface px-2 text-[11px] text-text focus:outline-none"
		>
			<option>normal</option>
			<option>multiply</option>
			<option>screen</option>
			<option>overlay</option>
			<option>soft light</option>
		</select>
		<span class="text-[11px] text-muted">opacity</span>
		<span class="font-mono text-[11px]">100%</span>
	</div>

	<div class="space-y-1 p-2">
		<div class="flex h-11 items-center gap-2 rounded border border-accent bg-surface px-2">
			<Eye size={12} class="shrink-0 text-muted" />
			<div
				class="flex size-7 shrink-0 items-center justify-center rounded-sm bg-elevated text-muted"
			>
				<SlidersHorizontal size={12} />
			</div>
			<span class="min-w-0 flex-1 truncate text-[11px]">color & tone</span>
			<div class="size-6 rounded-sm bg-white"></div>
		</div>

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
				<button type="button" aria-label="Layer options" class="text-muted hover:text-text">
					<MoreHorizontal size={12} />
				</button>
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

	<div
		class="sticky bottom-0 mt-4 flex h-9 items-center justify-end gap-1 border-t border-subtle bg-bg px-2"
	>
		<button
			type="button"
			aria-label="Add layer mask"
			class="flex size-6 items-center justify-center rounded text-muted hover:bg-surface hover:text-text"
		>
			<CircleDashed size={12} />
		</button>
		<button
			type="button"
			aria-label="New layer"
			class="flex size-6 items-center justify-center rounded text-muted hover:bg-surface hover:text-text"
		>
			<Plus size={12} />
		</button>
		<button
			type="button"
			aria-label="Delete layer"
			class="flex size-6 items-center justify-center rounded text-muted hover:bg-surface hover:text-negative"
		>
			<Trash2 size={12} />
		</button>
	</div>
</Tabs.Content>

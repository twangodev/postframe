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
	<div class="border-subtle flex items-center gap-2 border-b p-2">
		<select
			aria-label="Layer blend mode"
			class="border-subtle bg-surface text-text h-7 min-w-0 flex-1 cursor-pointer rounded border px-2 text-[11px] focus:outline-none"
		>
			<option>normal</option>
			<option>multiply</option>
			<option>screen</option>
			<option>overlay</option>
			<option>soft light</option>
		</select>
		<span class="text-muted text-[11px]">opacity</span>
		<span class="font-mono text-[11px]">100%</span>
	</div>

	<div class="space-y-1 p-2">
		<div class="border-accent bg-surface flex h-11 items-center gap-2 rounded border px-2">
			<Eye size={12} class="text-muted shrink-0" />
			<div
				class="bg-elevated text-muted flex size-7 shrink-0 items-center justify-center rounded-sm"
			>
				<SlidersHorizontal size={12} />
			</div>
			<span class="min-w-0 flex-1 truncate text-[11px]">color & tone</span>
			<div class="size-6 rounded-sm bg-white"></div>
		</div>

		{#each workspace.masks as mask (mask.id)}
			<div class="border-subtle flex h-10 items-center gap-2 rounded border px-2">
				{#if mask.visible}<Eye size={12} class="text-muted shrink-0" />{:else}<EyeOff
						size={12}
						class="text-muted shrink-0"
					/>{/if}
				<div
					class="bg-elevated text-muted flex size-7 shrink-0 items-center justify-center rounded-sm"
				>
					<CircleDashed size={12} />
				</div>
				<span class="min-w-0 flex-1 truncate text-[11px]">{mask.name}</span>
				<button type="button" aria-label="Layer options" class="text-muted hover:text-text">
					<MoreHorizontal size={12} />
				</button>
			</div>
		{/each}

		<div class="border-subtle flex h-11 items-center gap-2 rounded border px-2">
			<Eye size={12} class="text-muted shrink-0" />
			<div class="bg-canvas size-7 shrink-0 overflow-hidden rounded-sm">
				{#if active}<PhotoVisual photo={active} onRequest={workspace.loadThumbnail} />{/if}
			</div>
			<span class="min-w-0 flex-1 truncate font-mono text-[11px]">
				{active?.name ?? 'photograph'}
			</span>
			<Lock size={11} class="text-muted" />
		</div>
	</div>

	<div
		class="border-subtle bg-bg sticky bottom-0 mt-4 flex h-9 items-center justify-end gap-1 border-t px-2"
	>
		<button
			type="button"
			aria-label="Add layer mask"
			class="text-muted hover:bg-surface hover:text-text flex size-6 items-center justify-center rounded"
		>
			<CircleDashed size={12} />
		</button>
		<button
			type="button"
			aria-label="New layer"
			class="text-muted hover:bg-surface hover:text-text flex size-6 items-center justify-center rounded"
		>
			<Plus size={12} />
		</button>
		<button
			type="button"
			aria-label="Delete layer"
			class="text-muted hover:bg-surface hover:text-negative flex size-6 items-center justify-center rounded"
		>
			<Trash2 size={12} />
		</button>
	</div>
</Tabs.Content>

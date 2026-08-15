<script lang="ts">
	import { Flag, Star } from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import {
		camera,
		colorLabelChoices,
		dimensions,
		exposure,
		formatDecimal,
		labelColors
	} from '$lib/photo-format';
	import { formatBytes, type WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const active = $derived(workspace.selectedPhoto);
</script>

<aside
	class="motion-panel-right border-subtle bg-bg min-h-0 overflow-y-auto border-l {workspace.photos
		.length === 0
		? 'hidden'
		: ''}"
>
	{#if active}
		{#key active.id}
			<div class="motion-photo border-subtle bg-canvas aspect-[4/3] overflow-hidden border-b">
				<PhotoVisual photo={active} onRequest={workspace.loadThumbnail} />
			</div>
		{/key}
		<div class="border-subtle border-b p-3">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="truncate text-[12px] font-medium">{active.name}</p>
					<p class="text-muted mt-1 font-mono text-[11px]">
						{active.extension} · {formatBytes(active.size)}
					</p>
				</div>
				<button
					type="button"
					aria-label={active.flagged ? 'Remove flag' : 'Flag photo'}
					class="text-muted hover:text-text cursor-pointer rounded p-1 transition-colors"
					onclick={() => workspace.toggleFlag(active.id)}
				>
					<Flag size={14} class={active.flagged ? 'fill-text text-text' : ''} />
				</button>
			</div>
			<div class="mt-3 flex items-center justify-between">
				<div class="flex gap-0.5">
					{#each [1, 2, 3, 4, 5] as rating}
						<button
							type="button"
							aria-label={`Rate ${rating} stars`}
							class="text-muted hover:text-text cursor-pointer transition-colors"
							onclick={() => workspace.setRating(active.id, rating)}
						>
							<Star size={12} class={active.rating >= rating ? 'fill-text text-text' : ''} />
						</button>
					{/each}
				</div>
				<div class="flex gap-1.5">
					{#each colorLabelChoices as color}
						<button
							type="button"
							aria-label={`${color} label`}
							class="ring-offset-bg size-2.5 cursor-pointer rounded-full ring-offset-1 {active.colorLabel ===
							color
								? 'ring-text ring-1'
								: 'opacity-55 hover:opacity-100'}"
							style:background={labelColors[color]}
							onclick={() => workspace.setColorLabel(active.id, color)}
						></button>
					{/each}
				</div>
			</div>
		</div>

		<div class="border-subtle border-b p-3">
			<p class="text-muted mb-3 text-[11px] tracking-[0.04em]">metadata</p>
			<dl class="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-[11px]">
				<dt class="text-muted">captured</dt>
				<dd class="text-text/80 text-right">{active.captured}</dd>
				<dt class="text-muted">dimensions</dt>
				<dd class="text-text/80 text-right font-mono">{dimensions(active)}</dd>
				<dt class="text-muted">camera</dt>
				<dd class="text-text/80 text-right">{camera(active)}</dd>
				<dt class="text-muted">lens</dt>
				<dd class="text-text/80 text-right">{active.metadata?.lens ?? '—'}</dd>
				<dt class="text-muted">focal length</dt>
				<dd class="text-text/80 text-right font-mono">
					{active.metadata?.focalLengthMm
						? `${formatDecimal(active.metadata.focalLengthMm)} mm`
						: '—'}
				</dd>
				<dt class="text-muted">exposure</dt>
				<dd class="text-text/80 text-right font-mono">{exposure(active)}</dd>
			</dl>
		</div>

		<div class="p-3">
			<p class="text-muted mb-2 text-[11px] tracking-[0.04em]">collections</p>
			<div class="space-y-1">
				{#each workspace.collections as collection (collection.id)}
					<label
						class="text-muted hover:text-text flex cursor-pointer items-center gap-2 py-1 text-[12px]"
					>
						<input
							type="checkbox"
							checked={collection.photoIds.includes(active.id)}
							onchange={() => workspace.toggleCollection(active.id, collection.id)}
							class="accent-accent"
						/>
						{collection.name}
					</label>
				{/each}
				{#if workspace.collections.length === 0}
					<button
						type="button"
						class="text-muted hover:text-text cursor-pointer text-[12px] transition-colors"
						onclick={workspace.requestCollectionCreation}
					>
						+ create a collection
					</button>
				{/if}
			</div>
		</div>
	{:else}
		<div class="text-muted flex h-full items-center justify-center px-6 text-center text-[11px]">
			select a photo to inspect it.
		</div>
	{/if}
</aside>

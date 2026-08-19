<script lang="ts">
	import { Flag } from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import RatingStars from './ui/RatingStars.svelte';
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
	class="motion-panel-right min-h-0 overflow-y-auto border-l border-subtle bg-bg {workspace.photos
		.length === 0
		? 'hidden'
		: ''}"
>
	{#if active}
		{#key active.id}
			<div class="motion-photo aspect-[4/3] overflow-hidden border-b border-subtle bg-canvas">
				<PhotoVisual photo={active} onRequest={workspace.loadThumbnail} />
			</div>
		{/key}
		<div class="border-b border-subtle p-3">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="truncate text-[12px] font-medium">{active.name}</p>
					<p class="mt-1 font-mono text-[11px] text-muted">
						{active.extension} · {formatBytes(active.size)}
					</p>
				</div>
				<button
					type="button"
					aria-label={active.flagged ? 'Remove flag' : 'Flag photo'}
					class="cursor-pointer rounded p-1 text-muted transition-colors hover:text-text"
					onclick={() => workspace.toggleFlag(active.id)}
				>
					<Flag size={14} class={active.flagged ? 'fill-text text-text' : ''} />
				</button>
			</div>
			<div class="mt-3 flex items-center justify-between">
				<RatingStars
					rating={active.rating}
					onRate={(rating) => workspace.setRating(active.id, rating)}
				/>
				<div class="flex gap-1.5">
					{#each colorLabelChoices as color (color)}
						<button
							type="button"
							aria-label={`${color} label`}
							class="size-2.5 cursor-pointer rounded-full ring-offset-1 ring-offset-bg {active.colorLabel ===
							color
								? 'ring-1 ring-text'
								: 'opacity-55 hover:opacity-100'}"
							style:background={labelColors[color]}
							onclick={() => workspace.setColorLabel(active.id, color)}
						></button>
					{/each}
				</div>
			</div>
		</div>

		<div class="border-b border-subtle p-3">
			<p class="mb-3 text-[11px] tracking-[0.04em] text-muted">metadata</p>
			<dl class="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-[11px]">
				<dt class="text-muted">captured</dt>
				<dd class="text-right text-text/80">{active.captured}</dd>
				<dt class="text-muted">dimensions</dt>
				<dd class="text-right font-mono text-text/80">{dimensions(active)}</dd>
				<dt class="text-muted">camera</dt>
				<dd class="text-right text-text/80">{camera(active)}</dd>
				<dt class="text-muted">lens</dt>
				<dd class="text-right text-text/80">{active.metadata?.lens ?? '—'}</dd>
				<dt class="text-muted">focal length</dt>
				<dd class="text-right font-mono text-text/80">
					{active.metadata?.focalLengthMm
						? `${formatDecimal(active.metadata.focalLengthMm)} mm`
						: '—'}
				</dd>
				<dt class="text-muted">exposure</dt>
				<dd class="text-right font-mono text-text/80">{exposure(active)}</dd>
			</dl>
		</div>

		<div class="p-3">
			<p class="mb-2 text-[11px] tracking-[0.04em] text-muted">collections</p>
			<div class="space-y-1">
				{#each workspace.collections as collection (collection.id)}
					<label
						class="flex cursor-pointer items-center gap-2 py-1 text-[12px] text-muted hover:text-text"
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
						class="cursor-pointer text-[12px] text-muted transition-colors hover:text-text"
						onclick={workspace.requestCollectionCreation}
					>
						+ create a collection
					</button>
				{/if}
			</div>
		</div>
	{:else}
		<div class="flex h-full items-center justify-center px-6 text-center text-[11px] text-muted">
			select a photo to inspect it.
		</div>
	{/if}
</aside>

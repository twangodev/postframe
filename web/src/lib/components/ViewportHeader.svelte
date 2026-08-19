<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { Columns2, Maximize2, Minus, Plus } from '@lucide/svelte';
	import IconButton from './ui/IconButton.svelte';
	import { ZOOM_MENU_PRESETS } from '$lib/photo-viewport';
	import type { ViewportInteraction } from '$lib/viewport-interaction.svelte';

	interface Props {
		viewport: ViewportInteraction;
		photoName: string | null;
		before: boolean;
	}

	let { viewport, photoName, before = $bindable() }: Props = $props();

	const zoomMenuItemClass =
		'data-[highlighted]:bg-elevated data-[highlighted]:text-text flex h-7 min-w-32 cursor-default items-center rounded-sm px-2 text-[11px] outline-none';

	function formatZoom(scale: number) {
		const percent = scale * 100;
		return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
	}
</script>

<div class="flex h-9 shrink-0 items-center justify-between border-b border-subtle bg-bg px-3">
	<div class="flex items-center gap-1 text-muted">
		<IconButton
			label="Fit image to view"
			tooltip
			active={viewport.mode === 'fit'}
			onclick={viewport.fitPhoto}
		>
			<Maximize2 size={12} />
		</IconButton>
		<IconButton label="Zoom out" onclick={viewport.zoomOut}>
			<Minus size={12} />
		</IconButton>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				aria-label="Choose zoom level"
				class="flex h-6 min-w-12 cursor-pointer items-center justify-center rounded px-1 font-mono text-[11px] tabular-nums outline-none hover:bg-surface hover:text-text"
			>
				{formatZoom(viewport.transform.scale)}
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="start"
					sideOffset={4}
					class="motion-menu z-50 min-w-36 rounded border border-subtle bg-bg p-1 shadow-2xl"
				>
					<DropdownMenu.Item class={zoomMenuItemClass} onSelect={viewport.fitPhoto}>
						<span class="w-3 text-accent">{viewport.mode === 'fit' ? '•' : ''}</span>
						<span class="flex-1">fit</span>
						<kbd class="font-mono text-[10px] text-muted">0</kbd>
					</DropdownMenu.Item>
					<DropdownMenu.Item class={zoomMenuItemClass} onSelect={viewport.showActualPixels}>
						<span class="w-3 text-accent"
							>{viewport.mode === 'manual' && Math.abs(viewport.transform.scale - 1) < 0.0001
								? '•'
								: ''}</span
						>
						<span class="flex-1">actual pixels</span>
						<kbd class="font-mono text-[10px] text-muted">1</kbd>
					</DropdownMenu.Item>
					<DropdownMenu.Separator class="my-1 h-px bg-subtle" />
					{#each ZOOM_MENU_PRESETS as scale (scale)}
						<DropdownMenu.Item class={zoomMenuItemClass} onSelect={viewport.chooseZoom(scale)}>
							<span class="w-3 text-accent"
								>{viewport.mode === 'manual' && Math.abs(viewport.transform.scale - scale) < 0.0001
									? '•'
									: ''}</span
							>
							<span>{formatZoom(scale)}</span>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
		<IconButton label="Zoom in" onclick={viewport.zoomIn}>
			<Plus size={12} />
		</IconButton>
	</div>

	{#if photoName !== null}
		<p class="max-w-64 truncate font-mono text-[11px] tracking-wide text-muted">
			{photoName}
		</p>
	{/if}

	<!-- TODO(WASM_TODOS.previewRendering): switch between original and rendered Wasm output. -->
	<button
		type="button"
		class="flex h-6 cursor-pointer items-center gap-1.5 rounded border border-subtle px-2 text-[11px] text-muted transition-colors hover:text-text"
		onclick={() => (before = !before)}
	>
		<Columns2 size={11} />
		{before ? 'before' : 'after'}
	</button>
</div>

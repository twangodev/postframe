<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { Columns2, Maximize2, Minus, Plus } from '@lucide/svelte';
	import Tooltip from './ui/Tooltip.svelte';
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

<div class="border-subtle bg-bg flex h-9 shrink-0 items-center justify-between border-b px-3">
	<div class="text-muted flex items-center gap-1">
		<Tooltip text="Fit image to view">
			{#snippet children(props)}
				<button
					{...props}
					type="button"
					aria-label="Fit image to view"
					class="hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded {viewport.mode ===
					'fit'
						? 'text-accent'
						: ''}"
					onclick={viewport.fitPhoto}
				>
					<Maximize2 size={12} />
				</button>
			{/snippet}
		</Tooltip>
		<button
			type="button"
			aria-label="Zoom out"
			class="hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded"
			onclick={viewport.zoomOut}
		>
			<Minus size={12} />
		</button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				aria-label="Choose zoom level"
				class="hover:bg-surface hover:text-text flex h-6 min-w-12 cursor-pointer items-center justify-center rounded px-1 font-mono text-[11px] tabular-nums outline-none"
			>
				{formatZoom(viewport.transform.scale)}
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="start"
					sideOffset={4}
					class="motion-menu border-subtle bg-bg z-50 min-w-36 rounded border p-1 shadow-2xl"
				>
					<DropdownMenu.Item class={zoomMenuItemClass} onSelect={viewport.fitPhoto}>
						<span class="text-accent w-3">{viewport.mode === 'fit' ? '•' : ''}</span>
						<span class="flex-1">fit</span>
						<kbd class="text-muted font-mono text-[10px]">0</kbd>
					</DropdownMenu.Item>
					<DropdownMenu.Item class={zoomMenuItemClass} onSelect={viewport.showActualPixels}>
						<span class="text-accent w-3"
							>{viewport.mode === 'manual' && Math.abs(viewport.transform.scale - 1) < 0.0001
								? '•'
								: ''}</span
						>
						<span class="flex-1">actual pixels</span>
						<kbd class="text-muted font-mono text-[10px]">1</kbd>
					</DropdownMenu.Item>
					<DropdownMenu.Separator class="bg-subtle my-1 h-px" />
					{#each ZOOM_MENU_PRESETS as scale}
						<DropdownMenu.Item class={zoomMenuItemClass} onSelect={viewport.chooseZoom(scale)}>
							<span class="text-accent w-3"
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
		<button
			type="button"
			aria-label="Zoom in"
			class="hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded"
			onclick={viewport.zoomIn}
		>
			<Plus size={12} />
		</button>
	</div>

	{#if photoName !== null}
		<p class="text-muted max-w-64 truncate font-mono text-[11px] tracking-wide">
			{photoName}
		</p>
	{/if}

	<!-- TODO(WASM_TODOS.previewRendering): switch between original and rendered Wasm output. -->
	<button
		type="button"
		class="border-subtle text-muted hover:text-text flex h-6 cursor-pointer items-center gap-1.5 rounded border px-2 text-[11px] transition-colors"
		onclick={() => (before = !before)}
	>
		<Columns2 size={11} />
		{before ? 'before' : 'after'}
	</button>
</div>

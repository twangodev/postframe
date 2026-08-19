<script lang="ts">
	import { Columns2, Maximize2, Minus, Plus } from '@lucide/svelte';
	import DropdownMenu from './ui/DropdownMenu.svelte';
	import IconButton from './ui/IconButton.svelte';
	import { separator, type MenuLeaf } from '$lib/menu';
	import { ZOOM_MENU_PRESETS } from '$lib/photo-viewport';
	import type { ViewportInteraction } from '$lib/viewport-interaction.svelte';

	interface Props {
		viewport: ViewportInteraction;
		photoName: string | null;
		before: boolean;
	}

	let { viewport, photoName, before = $bindable() }: Props = $props();

	type ZoomAction = 'fit' | 'actual' | number;

	const manualScale = (scale: number) =>
		viewport.mode === 'manual' && Math.abs(viewport.transform.scale - scale) < 0.0001;

	const zoomMenu: MenuLeaf<ZoomAction>[] = $derived([
		{
			kind: 'action',
			label: 'fit',
			action: 'fit',
			shortcut: '0',
			checked: viewport.mode === 'fit'
		},
		{
			kind: 'action',
			label: 'actual pixels',
			action: 'actual',
			shortcut: '1',
			checked: manualScale(1)
		},
		separator(),
		...ZOOM_MENU_PRESETS.map((scale): MenuLeaf<ZoomAction> => ({
			kind: 'action',
			label: formatZoom(scale),
			action: scale,
			checked: manualScale(scale)
		}))
	]);

	function runZoomAction(action: ZoomAction) {
		if (action === 'fit') viewport.fitPhoto();
		else if (action === 'actual') viewport.showActualPixels();
		else viewport.setZoom(action);
	}

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
		<DropdownMenu items={zoomMenu} onAction={runZoomAction} size="compact">
			{#snippet children({ props })}
				<button
					{...props}
					type="button"
					aria-label="Choose zoom level"
					class="flex h-6 min-w-12 cursor-pointer items-center justify-center rounded px-1 font-mono text-[11px] tabular-nums outline-none hover:bg-surface hover:text-text"
				>
					{formatZoom(viewport.transform.scale)}
				</button>
			{/snippet}
		</DropdownMenu>
		<IconButton label="Zoom in" onclick={viewport.zoomIn}>
			<Plus size={12} />
		</IconButton>
	</div>

	{#if photoName !== null}
		<p class="max-w-64 truncate font-mono text-[11px] tracking-wide text-muted">
			{photoName}
		</p>
	{/if}

	<button
		type="button"
		title="compare with the original (hold \\)"
		class="flex h-6 cursor-pointer items-center gap-1.5 rounded border border-subtle px-2 text-[11px] text-muted transition-colors hover:text-text"
		onclick={() => (before = !before)}
	>
		<Columns2 size={11} />
		{before ? 'before' : 'after'}
	</button>
</div>

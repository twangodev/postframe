<script lang="ts">
	import { Tabs } from 'bits-ui';
	import { onMount } from 'svelte';
	import { tinykeys } from 'tinykeys';
	import AdjustPanel from './AdjustPanel.svelte';
	import EditViewport from './EditViewport.svelte';
	import Filmstrip from './Filmstrip.svelte';
	import LayersPanel from './LayersPanel.svelte';
	import MaskPanel from './MaskPanel.svelte';
	import ToolOptionsBar from './ToolOptionsBar.svelte';
	import ToolRail from './ToolRail.svelte';
	import ViewportHeader from './ViewportHeader.svelte';
	import { EditorToolSession } from '$lib/editor-tool-session.svelte';
	import { toolShortcutHandlers } from '$lib/editor-tools';
	import { ViewportInteraction, editableTarget } from '$lib/viewport-interaction.svelte';
	import { type WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		onExport: () => void;
	}

	let { workspace, onExport }: Props = $props();

	let before = $state(false);
	let beforeHeldByKey = false;
	let fittedPhotoKey = '';

	function holdOriginal(event: KeyboardEvent) {
		if (event.key !== '\\' || event.repeat || editableTarget(event.target)) return;
		beforeHeldByKey = true;
		before = true;
	}

	function releaseOriginal(event: Event) {
		if (!beforeHeldByKey) return;
		if (event instanceof KeyboardEvent && event.key !== '\\') return;
		beforeHeldByKey = false;
		before = false;
	}

	$effect(() => {
		workspace.compareOriginal(before);
	});

	const inspectorTabs = ['adjust', 'mask', 'layers'] as const;
	const inspectorTabClass =
		'cursor-pointer border-b border-transparent text-[11px] tracking-[0.03em] text-muted data-[state=active]:border-text data-[state=active]:text-text';

	const active = $derived(workspace.editingPhoto);
	const imageSize = $derived({
		width: Math.max(1, active?.width ?? 1600),
		height: Math.max(1, active?.height ?? 1067)
	});

	const session = new EditorToolSession({
		get workspace() {
			return workspace;
		},
		onToolChange: () => (viewport.brushPoint = null)
	});

	const viewport = new ViewportInteraction({
		image: () => imageSize,
		enabled: () => active !== null,
		tool: () => session.tool,
		selectedMask: () => session.selectedMask,
		canRefineMask: () => session.canRefineSelectedMask,
		smartMaskWorking: () => session.smartMaskWorking,
		brushSize: () => session.refineBrushSize,
		maskBrushOperation: () => session.maskBrushOperation,
		refineMaskEdge: (stroke) => workspace.refineMaskEdge(stroke),
		paintObjectMask: (points, label) => workspace.paintObjectMask(points, label),
		paintBrushMask: (stroke, operation) => workspace.paintBrushMask(stroke, operation),
		placeGradientComponent: (component) => workspace.placeGradientComponent(component),
		sampleWhiteBalance: (point) => workspace.sampleWhiteBalance(point)
	});

	$effect(() => {
		const key = active ? `${active.id}:${imageSize.width}:${imageSize.height}` : '';
		if (!key || key === fittedPhotoKey) return;
		fittedPhotoKey = key;
		viewport.fitPhoto();
	});

	onMount(() =>
		tinykeys(window, {
			...toolShortcutHandlers(() => session.tool, session.choose),
			j: (event) => {
				if (editableTarget(event.target)) return;
				event.preventDefault();
				workspace.toggleClipping();
			}
		})
	);

	onMount(() => {
		const element = viewport.element;
		if (!element) return;

		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			viewport.resize({ width: entry.contentRect.width, height: entry.contentRect.height });
		});
		observer.observe(element);

		window.addEventListener('keydown', viewport.handleKeyDown);
		window.addEventListener('keyup', viewport.handleKeyUp);
		window.addEventListener('blur', viewport.handleBlur);
		window.addEventListener('keydown', holdOriginal);
		window.addEventListener('keyup', releaseOriginal);
		window.addEventListener('blur', releaseOriginal);
		return () => {
			observer.disconnect();
			window.removeEventListener('keydown', viewport.handleKeyDown);
			window.removeEventListener('keyup', viewport.handleKeyUp);
			window.removeEventListener('blur', viewport.handleBlur);
			window.removeEventListener('keydown', holdOriginal);
			window.removeEventListener('keyup', releaseOriginal);
			window.removeEventListener('blur', releaseOriginal);
		};
	});
</script>

<div class="flex min-h-0 flex-1 flex-col bg-canvas">
	<div class="flex min-h-0 flex-1">
		<ToolRail
			activeTool={session.tool}
			onSelect={session.choose}
			canUndo={workspace.canUndo}
			canRedo={workspace.canRedo}
			onUndo={workspace.undo}
			onRedo={workspace.redo}
		/>

		<section class="motion-panel-up flex min-w-0 flex-1 flex-col">
			<ViewportHeader {viewport} photoName={active?.name ?? null} bind:before />

			<ToolOptionsBar tools={session} />

			<EditViewport {workspace} {viewport} tools={session} {before} {onExport} />

			<footer
				class="flex h-7 shrink-0 items-center justify-between border-t border-subtle bg-bg px-3 text-[11px] tracking-wide text-muted"
			>
				<span>display · SDR preview</span>
				{#if active}
					<output
						title="Visible source pixels · full image pixels"
						aria-label={`Viewing ${Math.round(viewport.visiblePixels.width)} by ${Math.round(viewport.visiblePixels.height)} of ${imageSize.width} by ${imageSize.height} source pixels`}
						class="flex items-baseline gap-1 whitespace-nowrap"
					>
						<span>view</span>
						<span class="font-mono tabular-nums"
							>{Math.round(viewport.visiblePixels.width)} × {Math.round(
								viewport.visiblePixels.height
							)}</span
						>
						<span>· total</span>
						<span class="font-mono tabular-nums">{imageSize.width} × {imageSize.height}</span>
						<span>px</span>
					</output>
				{:else}
					<span>— × — px</span>
				{/if}
			</footer>
		</section>

		<aside
			class="motion-panel-right w-72 shrink-0 overflow-y-auto border-l border-subtle bg-bg max-[1080px]:w-64"
		>
			<Tabs.Root bind:value={session.inspectorTab}>
				<Tabs.List class="grid h-10 grid-cols-3 border-b border-subtle bg-bg px-2 pt-1">
					{#each inspectorTabs as tab (tab)}
						<Tabs.Trigger value={tab} class={inspectorTabClass}>
							{tab}
							{#if tab === 'mask' && workspace.masks.length > 0}<span class="ml-1 text-accent"
									>{workspace.masks.length}</span
								>{/if}
						</Tabs.Trigger>
					{/each}
				</Tabs.List>

				<AdjustPanel {workspace} activeTool={session.tool} onPickTool={session.choose} />

				<MaskPanel {workspace} tools={session} />

				<LayersPanel {workspace} />
			</Tabs.Root>
		</aside>
	</div>

	<Filmstrip {workspace} />
</div>

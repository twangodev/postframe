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
	import { toolShortcutHandlers } from '$lib/editor-tools';
	import type { NormalizedRegion } from '$lib/edit-document';
	import { type MaskPreviewMode } from '$lib/mask-preview';
	import { ViewportInteraction } from '$lib/viewport-interaction.svelte';
	import { type MaskKind, type WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		onExport: () => void;
	}

	let { workspace, onExport }: Props = $props();

	let activeTool = $state('move');
	let activeToolLabel = $state('move');
	let inspectorTab = $state('adjust');
	let before = $state(false);
	let maskPreviewMode = $state<MaskPreviewMode | null>('overlay');
	let maskBrushOperation = $state<'add' | 'subtract'>('add');
	let refineBrushSize = $state(42);
	let hoveredSubjectBox = $state<NormalizedRegion | null>(null);
	let fittedPhotoKey = '';

	const active = $derived(workspace.editingPhoto);
	const imageSize = $derived({
		width: Math.max(1, active?.width ?? 1600),
		height: Math.max(1, active?.height ?? 1067)
	});
	const selectedMask = $derived(
		workspace.masks.find((mask) => mask.id === workspace.selectedMaskId) ?? null
	);
	const subjectChoices = $derived(
		workspace.subjectChoices?.photoId === workspace.editingPhoto?.id
			? workspace.subjectChoices
			: null
	);
	const canRefineSelectedMask = $derived(
		selectedMask?.components.filter(
			(component) =>
				(component.type === 'ai-object' || component.type === 'ai-subject') &&
				component.raster !== null
		).length === 1
	);
	const smartMaskWorking = $derived(
		['downloading', 'loading', 'encoding', 'refining'].includes(workspace.smartMaskStatus.phase)
	);

	const viewport = new ViewportInteraction({
		image: () => imageSize,
		enabled: () => active !== null,
		tool: () => activeTool,
		selectedMask: () => selectedMask,
		canRefineMask: () => canRefineSelectedMask,
		smartMaskWorking: () => smartMaskWorking,
		brushSize: () => refineBrushSize,
		maskBrushOperation: () => maskBrushOperation,
		refineMaskEdge: (stroke) => workspace.refineMaskEdge(stroke),
		paintObjectMask: (points, label) => workspace.paintObjectMask(points, label),
		paintBrushMask: (stroke, operation) => workspace.paintBrushMask(stroke, operation),
		placeLinearMask: (start, end) => workspace.placeLinearMask(start, end),
		placeRadialMask: (center, radius) => workspace.placeRadialMask(center, radius),
		placeGradientComponent: (component) => workspace.placeGradientComponent(component)
	});

	$effect(() => {
		const key = active ? `${active.id}:${imageSize.width}:${imageSize.height}` : '';
		if (!key || key === fittedPhotoKey) return;
		fittedPhotoKey = key;
		viewport.fitPhoto();
	});

	function chooseTool(tool: string, label = tool) {
		// TODO(WASM_TODOS.editorTools): start the selected tool in the Wasm document.
		if (tool === 'object-select' && activeTool !== 'object-select') workspace.selectMask(null);
		activeTool = tool;
		activeToolLabel = label;
		viewport.brushPoint = null;
		if (tool.startsWith('mask')) inspectorTab = 'mask';
	}

	onMount(() =>
		tinykeys(
			window,
			toolShortcutHandlers(() => activeTool, chooseTool)
		)
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
		return () => {
			observer.disconnect();
			window.removeEventListener('keydown', viewport.handleKeyDown);
			window.removeEventListener('keyup', viewport.handleKeyUp);
			window.removeEventListener('blur', viewport.handleBlur);
		};
	});

	function addMask(kind: MaskKind) {
		workspace.createMask(kind);
		if (kind === 'linear') chooseTool('mask-linear', 'linear gradient');
		else if (kind === 'radial') chooseTool('mask-radial', 'radial gradient');
		else beginMaskBrush('add');
		maskPreviewMode = 'overlay';
	}

	function beginMaskBrush(operation: 'add' | 'subtract') {
		maskBrushOperation = operation;
		chooseTool('mask', 'mask brush');
		maskPreviewMode = 'overlay';
	}

	function beginObjectMask() {
		workspace.selectMask(null);
		chooseTool('object-select', 'object selection');
		inspectorTab = 'mask';
		maskPreviewMode = 'overlay';
	}

	function beginEdgeRefinement() {
		if (!canRefineSelectedMask) return;
		chooseTool('mask-refine', 'refine edge');
		maskPreviewMode = 'overlay';
	}
</script>

<div class="bg-canvas flex min-h-0 flex-1 flex-col">
	<div class="flex min-h-0 flex-1">
		<ToolRail
			{activeTool}
			onSelect={chooseTool}
			canUndo={workspace.canUndo}
			canRedo={workspace.canRedo}
			onUndo={workspace.undo}
			onRedo={workspace.redo}
		/>

		<section class="motion-panel-up flex min-w-0 flex-1 flex-col">
			<ViewportHeader {viewport} photoName={active?.name ?? null} bind:before />

			<ToolOptionsBar {activeTool} {activeToolLabel} {maskBrushOperation} {refineBrushSize} />

			<EditViewport
				{workspace}
				{viewport}
				{activeTool}
				{maskBrushOperation}
				{maskPreviewMode}
				{selectedMask}
				{subjectChoices}
				{hoveredSubjectBox}
				{smartMaskWorking}
				{before}
				{onExport}
			/>

			<footer
				class="border-subtle bg-bg text-muted flex h-7 shrink-0 items-center justify-between border-t px-3 text-[11px] tracking-wide"
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
			class="motion-panel-right border-subtle bg-bg w-72 shrink-0 overflow-y-auto border-l max-[1080px]:w-64"
		>
			<Tabs.Root bind:value={inspectorTab}>
				<Tabs.List class="border-subtle bg-bg grid h-10 grid-cols-3 border-b px-2 pt-1">
					<Tabs.Trigger
						value="adjust"
						class="text-muted data-[state=active]:border-text data-[state=active]:text-text cursor-pointer border-b border-transparent text-[11px] tracking-[0.03em]"
					>
						adjust
					</Tabs.Trigger>
					<Tabs.Trigger
						value="mask"
						class="text-muted data-[state=active]:border-text data-[state=active]:text-text cursor-pointer border-b border-transparent text-[11px] tracking-[0.03em]"
					>
						mask {#if workspace.masks.length > 0}<span class="text-accent ml-1"
								>{workspace.masks.length}</span
							>{/if}
					</Tabs.Trigger>
					<Tabs.Trigger
						value="layers"
						class="text-muted data-[state=active]:border-text data-[state=active]:text-text cursor-pointer border-b border-transparent text-[11px] tracking-[0.03em]"
					>
						layers
					</Tabs.Trigger>
				</Tabs.List>

				<AdjustPanel {workspace} />

				<MaskPanel
					{workspace}
					{activeTool}
					{maskBrushOperation}
					bind:maskPreviewMode
					bind:refineBrushSize
					{selectedMask}
					{subjectChoices}
					{smartMaskWorking}
					{canRefineSelectedMask}
					bind:hoveredSubjectBox
					onAddMask={addMask}
					onBeginMaskBrush={beginMaskBrush}
					onBeginObjectMask={beginObjectMask}
					onBeginEdgeRefinement={beginEdgeRefinement}
				/>

				<LayersPanel {workspace} />
			</Tabs.Root>
		</aside>
	</div>

	<Filmstrip {workspace} />
</div>

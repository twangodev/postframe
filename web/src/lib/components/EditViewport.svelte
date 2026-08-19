<script lang="ts">
	import MaskBrushCursor from './MaskBrushCursor.svelte';
	import MaskGradientGuides from './MaskGradientGuides.svelte';
	import MaskOverlay from './MaskOverlay.svelte';
	import MaskPaintPreview from './MaskPaintPreview.svelte';
	import MaskPromptOverlay from './MaskPromptOverlay.svelte';
	import PhotoPyramidLayer from './PhotoPyramidLayer.svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import SubjectHoverBox from './SubjectHoverBox.svelte';
	import ContextMenu from './ui/ContextMenu.svelte';
	import ProgressCard from './ui/ProgressCard.svelte';
	import { separator, type MenuEntry } from '$lib/menu';
	import { cropTools, retouchTools, selectionTools, typeTools } from '$lib/editor-tools';
	import type { EditorToolSession } from '$lib/editor-tool-session.svelte';
	import type { ViewportInteraction } from '$lib/viewport-interaction.svelte';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		viewport: ViewportInteraction;
		tools: EditorToolSession;
		before: boolean;
		onExport: () => void;
	}

	let { workspace, viewport, tools, before, onExport }: Props = $props();

	const active = $derived(workspace.editingPhoto);
	const activeDocument = $derived(workspace.activeDocument);
	const activeTool = $derived(tools.tool);
	const maskPreviewMode = $derived(tools.maskPreviewMode);
	const selectedMask = $derived(tools.selectedMask);
	const imageSize = $derived(viewport.image);
	const frame = $derived({ image: imageSize, scale: viewport.transform.scale });
	const surfaceStyle = $derived(
		`width: ${imageSize.width}px; height: ${imageSize.height}px; transform: translate3d(${viewport.imageOffset.x}px, ${viewport.imageOffset.y}px, 0) scale(${viewport.transform.scale}); transform-origin: top left; --viewport-scale: ${viewport.transform.scale};`
	);
	const cursorClass = $derived(
		viewport.gizmoCursor ??
			(viewport.panning
				? 'cursor-grabbing'
				: activeTool === 'hand' || viewport.spaceHeld
					? 'cursor-grab'
					: activeTool === 'zoom'
						? 'cursor-zoom-in'
						: (activeTool === 'mask-refine' || activeTool === 'mask') && viewport.brushPoint
							? 'cursor-none'
							: activeTool === 'object-select' ||
								  activeTool === 'eyedropper' ||
								  activeTool.startsWith('mask')
								? 'cursor-crosshair'
								: 'cursor-default')
	);

	type ViewportMenuAction = 'undo' | 'redo' | 'export';
	const viewportMenu: MenuEntry<ViewportMenuAction>[] = $derived([
		{ kind: 'action', label: 'undo', action: 'undo', shortcut: '⌘Z', disabled: !workspace.canUndo },
		{
			kind: 'action',
			label: 'redo',
			action: 'redo',
			shortcut: '⇧⌘Z',
			disabled: !workspace.canRedo
		},
		separator(),
		{ kind: 'action', label: 'export…', action: 'export', shortcut: '⇧⌘E' }
	]);

	function runViewportAction(action: ViewportMenuAction) {
		if (action === 'undo') workspace.undo();
		else if (action === 'redo') workspace.redo();
		else onExport();
	}
</script>

{#snippet viewportNotice(title: string, detail: string | null)}
	<div
		class="absolute inset-0 z-20 flex items-center justify-center bg-black/60 px-6 text-center text-white backdrop-blur-[1px]"
	>
		<div class="motion-enter flex max-w-72 flex-col items-center gap-2.5">
			<p class="text-[12px]">{title}</p>
			{#if detail}
				<p class="text-[10px] leading-relaxed text-white/55">{detail}</p>
			{/if}
			<button
				type="button"
				class="mt-1 cursor-pointer rounded border border-white/20 px-2.5 py-1 text-[11px] transition-colors hover:bg-white/10"
				onclick={workspace.reloadDocument}
			>
				retry
			</button>
		</div>
	</div>
{/snippet}

<ContextMenu items={viewportMenu} onAction={runViewportAction}>
	{#snippet children({ props })}
		<div
			{...props}
			bind:this={viewport.element}
			role="application"
			aria-label="Photo viewport"
			class="relative isolate min-h-0 flex-1 touch-none overflow-hidden [contain:paint] {cursorClass}"
			onwheel={viewport.handleWheel}
			onpointerdown={viewport.handlePointerDown}
			onpointermove={viewport.handlePointerMove}
			onpointerleave={viewport.handlePointerLeave}
			onpointerup={viewport.handlePointerUp}
			onpointercancel={viewport.handlePointerUp}
			onlostpointercapture={viewport.handlePointerUp}
			ondblclick={viewport.handleDoubleClick}
		>
			<div
				class="pointer-events-none absolute inset-0 [background-image:radial-gradient(#3c3a34_0.7px,transparent_0.7px)] [background-size:8px_8px] opacity-20"
			></div>
			{#if active}
				{#key `${active.id}:${active.src}`}
					<div
						class:viewport-pixelated={viewport.pixelGridStrength > 0}
						class="motion-viewport-photo absolute top-0 left-0 z-0 overflow-hidden bg-black shadow-2xl will-change-transform"
						style={surfaceStyle}
					>
						<PhotoVisual photo={active} contain onRequest={workspace.loadThumbnail} />
						{#if activeDocument?.kind === 'loading' && activeDocument.phase !== 'reading'}
							<div class="absolute inset-0 z-20 overflow-hidden text-white">
								<div class="develop-soft-focus pointer-events-none absolute inset-0"></div>
								<div
									class="develop-pixel-shift develop-pixel-shift-a pointer-events-none absolute inset-0"
								>
									<PhotoVisual photo={active} contain onRequest={workspace.loadThumbnail} />
								</div>
								<div
									class="develop-pixel-shift develop-pixel-shift-b pointer-events-none absolute inset-0"
								>
									<PhotoVisual photo={active} contain onRequest={workspace.loadThumbnail} />
								</div>
								<div class="develop-dither pointer-events-none absolute inset-0"></div>
								<div class="develop-glimmer pointer-events-none absolute"></div>
							</div>
						{/if}
					</div>
					<PhotoPyramidLayer
						photoId={active.id}
						enabled={activeDocument?.kind === 'ready'}
						viewport={viewport.size}
						image={imageSize}
						transform={viewport.transform}
						renderTile={workspace.renderTile}
						renderRevision={workspace.renderSettings.revision}
						adjustments={workspace.renderSettings.adjustments}
						crop={workspace.renderSettings.crop}
						clipping={workspace.clipping}
						onRenderSettled={workspace.settleDevelopRender}
					/>
					{#if workspace.developPreview?.photoId === active.id}
						<div
							class="motion-viewport-photo pointer-events-none absolute top-0 left-0 z-[15] overflow-hidden will-change-transform"
							class:bg-black={workspace.developPreview.src !== null}
							style={surfaceStyle}
						>
							{#if workspace.developPreview.src}
								<img
									src={workspace.developPreview.src}
									alt=""
									draggable="false"
									class="size-full object-fill"
								/>
							{/if}
							<div class="develop-soft-focus absolute inset-0"></div>
							<div class="develop-dither absolute inset-0"></div>
							<div class="develop-glimmer absolute"></div>
						</div>
					{/if}
					<div
						class="pointer-events-none absolute top-0 left-0 z-20 overflow-hidden will-change-transform"
						style={surfaceStyle}
					>
						{#if viewport.pixelGridStrength > 0}
							<div
								data-pixel-grid
								class="viewport-pixel-grid pointer-events-none absolute inset-0"
								style:opacity={viewport.pixelGridStrength}
							></div>
						{/if}
						{#if cropTools.has(activeTool)}
							<div
								class="viewport-hairline pointer-events-none absolute inset-[8%] border border-white/80 [background-image:linear-gradient(to_right,transparent_33.2%,rgba(255,255,255,0.45)_33.2%,rgba(255,255,255,0.45)_33.5%,transparent_33.5%,transparent_66.4%,rgba(255,255,255,0.45)_66.4%,rgba(255,255,255,0.45)_66.7%,transparent_66.7%),linear-gradient(to_bottom,transparent_33.2%,rgba(255,255,255,0.45)_33.2%,rgba(255,255,255,0.45)_33.5%,transparent_33.5%,transparent_66.4%,rgba(255,255,255,0.45)_66.4%,rgba(255,255,255,0.45)_66.7%,transparent_66.7%)] shadow-[0_0_0_999px_rgba(0,0,0,0.4)]"
							></div>
						{:else if retouchTools.has(activeTool) || ['brush', 'pencil', 'mixer-brush', 'eraser'].includes(activeTool)}
							<div
								class="viewport-hairline pointer-events-none absolute top-[46%] left-[58%] rounded-full border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
								style="width: calc(40px / var(--viewport-scale)); height: calc(40px / var(--viewport-scale));"
							></div>
						{:else if selectionTools.has(activeTool) && activeTool !== 'object-select'}
							<div
								class="viewport-hairline pointer-events-none absolute inset-[20%] rounded-[45%_55%_48%_52%/52%_42%_58%_48%] border border-dashed border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
							></div>
						{:else if typeTools.has(activeTool)}
							<div
								class="pointer-events-none absolute top-[38%] left-[30%] h-16 w-56 border border-white/75"
							>
								<span class="absolute top-1 left-1 text-2xl font-medium text-white/90"
									>postframe</span
								>
							</div>
						{/if}
						{#if selectedMask?.visible && maskPreviewMode && workspace.selectedMaskRaster?.maskId === selectedMask.id && !viewport.settlingPaint && !viewport.gizmoDrag?.moved}
							{#key maskPreviewMode}
								<MaskOverlay raster={workspace.selectedMaskRaster} mode={maskPreviewMode} />
							{/key}
						{/if}
						{#if viewport.livePaint ?? viewport.settlingPaint}
							<MaskPaintPreview
								paint={(viewport.livePaint ?? viewport.settlingPaint)!}
								image={imageSize}
								mode={maskPreviewMode === 'matte' ? 'matte' : 'overlay'}
							/>
						{/if}
						{#if viewport.objectStroke}
							<MaskPromptOverlay
								points={viewport.objectStroke.points}
								label={viewport.objectStroke.label}
								{frame}
							/>
						{/if}
						{#if viewport.edgeRefinementStroke}
							<MaskPromptOverlay
								points={viewport.edgeRefinementStroke.points}
								label="refine"
								brushRadius={viewport.edgeRefinementStroke.radius}
								{frame}
							/>
						{/if}
						{#if viewport.maskStroke && tools.maskBrushOperation === 'subtract'}
							<MaskPromptOverlay
								points={viewport.maskStroke.points}
								label="background"
								brushRadius={viewport.maskBrushSize / 2}
								{frame}
							/>
						{/if}
						{#if viewport.gizmoComponent}
							<MaskGradientGuides
								component={viewport.gizmoComponent}
								hover={viewport.gizmoHover}
								active={viewport.gizmoDrag?.grip ?? null}
								angle={viewport.gizmoAngle}
								{frame}
							/>
						{/if}
						{#if viewport.brushPoint && (activeTool === 'mask' || (activeTool === 'mask-refine' && !tools.smartMaskWorking))}
							<MaskBrushCursor
								point={viewport.brushPoint}
								radius={activeTool === 'mask'
									? viewport.maskBrushSize / 2
									: (viewport.edgeRefinementStroke?.radius ?? viewport.refineBrushRadius)}
								{frame}
							/>
						{/if}
						{#if tools.subjectChoices && tools.hoveredSubjectBox}
							<SubjectHoverBox box={tools.hoveredSubjectBox} {frame} />
						{/if}
					</div>
				{/key}
				{#if before}
					<span
						class="pointer-events-none absolute top-3 left-3 rounded-sm bg-black/65 px-2 py-1 text-[11px] tracking-wide text-white backdrop-blur"
					>
						before
					</span>
				{/if}
				{#if workspace.viewportProgress}
					<div
						class="pointer-events-none absolute right-3 bottom-3 left-3 z-30 flex justify-center"
					>
						<ProgressCard task={workspace.viewportProgress} variant="floating" />
					</div>
				{/if}
				{#if activeDocument?.kind === 'cancelled'}
					{@render viewportNotice('development stopped', null)}
				{:else if activeDocument?.kind === 'error'}
					{@render viewportNotice("couldn't open raw", activeDocument.message)}
				{/if}
			{:else}
				<p class="absolute inset-0 flex items-center justify-center text-[11px] text-muted">
					select a photo in organize.
				</p>
			{/if}
		</div>
	{/snippet}
</ContextMenu>

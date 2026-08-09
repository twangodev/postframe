<script lang="ts">
	import { DropdownMenu, Tabs } from 'bits-ui';
	import { onMount } from 'svelte';
	import { tinykeys } from 'tinykeys';
	import {
		Blend,
		Brush,
		CircleDashed,
		CloudSun,
		Columns2,
		ChevronLeft,
		ChevronRight,
		Eye,
		EyeOff,
		History,
		ImageDown,
		Lock,
		Maximize2,
		Minus,
		MoreHorizontal,
		Mountain,
		Plus,
		RotateCcw,
		Scan,
		SlidersHorizontal,
		Sparkles,
		Trash2,
		UserRound
	} from '@lucide/svelte';
	import PhotoVisual from './PhotoVisual.svelte';
	import PhotoPyramidLayer from './PhotoPyramidLayer.svelte';
	import MaskBrushCursor from './MaskBrushCursor.svelte';
	import MaskOverlay from './MaskOverlay.svelte';
	import MaskPromptOverlay from './MaskPromptOverlay.svelte';
	import ToolRail from './ToolRail.svelte';
	import AdjustmentSlider from './ui/AdjustmentSlider.svelte';
	import ImageScope from './ui/ImageScope.svelte';
	import Panel from './ui/Panel.svelte';
	import Tooltip from './ui/Tooltip.svelte';
	import {
		formatBytes,
		type DocumentStatus,
		type MaskKind,
		type WorkspaceState
	} from '$lib/workspace.svelte';
	import type { LightControlName } from '$lib/develop-settings';
	import type { MaskEdgeControlName } from '$lib/mask-edge-settings';
	import type { DevelopPhase } from '$lib/worker';
	import {
		ZOOM_MENU_PRESETS,
		clampTransform,
		fitScale,
		fittedTransform,
		nextZoomScale,
		panBy,
		pixelGridOpacity,
		screenToImage,
		surfaceTransform,
		visibleImageRect,
		wheelNavigation,
		zoomAt,
		type Point,
		type Size,
		type ViewportTransform
	} from '$lib/photo-viewport';
	import type { NormalizedPoint } from '$lib/edit-document';
	import { MASK_PREVIEW_MODES, type MaskPreviewMode } from '$lib/mask-preview';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();
	const previewLight = (control: LightControlName) => (value: number) =>
		workspace.previewLight(control, value);
	const commitLight = (control: LightControlName) => (value: number) =>
		workspace.commitLight(control, value);
	const previewMaskLight = (control: LightControlName) => (value: number) =>
		workspace.previewMaskLight(control, value);
	const commitMaskLight = (control: LightControlName) => (value: number) =>
		workspace.commitMaskLight(control, value);
	const previewMaskEdge = (control: MaskEdgeControlName) => (value: number) =>
		workspace.previewMaskEdge(control, value);
	const commitMaskEdge = (control: MaskEdgeControlName) => (value: number) =>
		workspace.commitMaskEdge(control, value);
	let activeTool = $state('move');
	let activeToolLabel = $state('move');
	let inspectorTab = $state('adjust');
	let before = $state(false);
	let maskPreviewMode = $state<MaskPreviewMode | null>('overlay');
	let viewportElement = $state<HTMLDivElement | null>(null);
	let viewportSize = $state<Size>({ width: 1, height: 1 });
	let viewportTransform = $state<ViewportTransform>({ scale: 1, pan: { x: 0, y: 0 } });
	let viewportMode = $state<'fit' | 'manual'>('fit');
	let panning = $state(false);
	let spaceHeld = $state(false);
	let fittedPhotoKey = '';
	let drag: { pointerId: number; origin: Point; transform: ViewportTransform } | null = null;
	let objectStroke = $state<{
		pointerId: number;
		label: 'foreground' | 'background';
		points: NormalizedPoint[];
	} | null>(null);
	let edgeRefinementStroke = $state<{
		pointerId: number;
		points: NormalizedPoint[];
		radius: number;
	} | null>(null);
	let maskBrushPoint = $state<NormalizedPoint | null>(null);
	let refineBrushSize = $state(42);
	let pinch: {
		origin: Point;
		distance: number;
		transform: ViewportTransform;
	} | null = null;
	const pointers = new Map<number, Point>();

	const active = $derived(workspace.editingPhoto);
	const imageSize = $derived({
		width: Math.max(1, active?.width ?? 1600),
		height: Math.max(1, active?.height ?? 1067)
	});
	const imageOffset = $derived(surfaceTransform(viewportSize, imageSize, viewportTransform));
	const visiblePixels = $derived(visibleImageRect(viewportSize, imageSize, viewportTransform));
	const pixelGridStrength = $derived(pixelGridOpacity(viewportTransform.scale));
	const refineBrushRadius = $derived(
		refineBrushSize / 2 / viewportTransform.scale / Math.max(imageSize.width, imageSize.height)
	);
	const selectedMask = $derived(
		workspace.masks.find((mask) => mask.id === workspace.selectedMaskId) ?? null
	);
	const selectedObjectComponent = $derived(
		selectedMask?.components.find((component) => component.type === 'ai-object') ?? null
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
	type LoadingDocument = Extract<DocumentStatus, { kind: 'loading' }>;
	const selectionTools = new Set([
		'object-select',
		'quick-select',
		'magic-wand',
		'marquee',
		'ellipse-marquee',
		'single-row-marquee',
		'single-column-marquee',
		'lasso',
		'polygon-lasso',
		'magnetic-lasso'
	]);
	const cropTools = new Set(['crop', 'perspective-crop', 'slice', 'slice-select', 'frame']);
	const retouchTools = new Set([
		'remove',
		'spot-heal',
		'healing-brush',
		'patch',
		'content-aware-move',
		'clone-stamp',
		'red-eye',
		'blur',
		'sharpen',
		'smudge',
		'dodge',
		'burn',
		'sponge',
		'background-eraser',
		'magic-eraser'
	]);
	const paintTools = new Set([
		'brush',
		'pencil',
		'mixer-brush',
		'color-replacement',
		'history-brush',
		'art-history-brush',
		'eraser',
		'gradient',
		'paint-bucket',
		'eyedropper',
		'color-sampler',
		'pattern-stamp'
	]);
	const vectorTools = new Set([
		'pen',
		'freeform-pen',
		'curvature-pen',
		'add-anchor',
		'delete-anchor',
		'convert-point',
		'path-select',
		'shape',
		'ellipse-shape',
		'triangle-shape',
		'polygon-shape',
		'star-shape',
		'line-shape',
		'custom-shape'
	]);
	const typeTools = new Set(['type', 'vertical-type', 'type-mask']);
	const measureTools = new Set(['ruler', 'note', 'count']);
	const generativeTools = new Set(['generative-fill', 'content-aware-fill', 'remove-background']);
	const zoomMenuItemClass =
		'data-[highlighted]:bg-elevated data-[highlighted]:text-text flex h-7 min-w-32 cursor-default items-center rounded-sm px-2 text-[10px] outline-none';
	const chooseMaskPreview = (mode: MaskPreviewMode | null) => () => (maskPreviewMode = mode);

	$effect(() => {
		const key = active ? `${active.id}:${imageSize.width}:${imageSize.height}` : '';
		if (!key || key === fittedPhotoKey) return;
		fittedPhotoKey = key;
		fitPhoto();
	});

	function chooseTool(tool: string, label = tool) {
		// TODO(WASM_TODOS.editorTools): start the selected tool in the Wasm document.
		activeTool = tool;
		activeToolLabel = label;
		maskBrushPoint = null;
		if (tool.startsWith('mask')) inspectorTab = 'mask';
	}

	function selectShortcut(tool: string, label: string) {
		return (event: KeyboardEvent) => {
			event.preventDefault();
			chooseTool(tool, label);
		};
	}

	function cycleShortcut(tools: [string, string][]) {
		return (event: KeyboardEvent) => {
			event.preventDefault();
			const current = tools.findIndex(([tool]) => tool === activeTool);
			const [tool, label] = tools[(current + 1) % tools.length];
			chooseTool(tool, label);
		};
	}

	function fitPhoto() {
		viewportMode = 'fit';
		viewportTransform = fittedTransform(viewportSize, imageSize);
	}

	function showActualPixels() {
		setZoom(1);
	}

	function setZoom(scale: number, anchor = viewportCenter()) {
		viewportMode = 'manual';
		viewportTransform = zoomAt(viewportTransform, scale, anchor, viewportSize, imageSize);
	}

	function stepZoom(direction: -1 | 1, anchor = viewportCenter()) {
		setZoom(
			nextZoomScale(viewportTransform.scale, direction, fitScale(viewportSize, imageSize)),
			anchor
		);
	}

	function zoomIn() {
		stepZoom(1);
	}

	function zoomOut() {
		stepZoom(-1);
	}

	function chooseZoom(scale: number) {
		return () => setZoom(scale);
	}

	function formatZoom(scale: number) {
		const percent = scale * 100;
		return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
	}

	function viewportCenter() {
		return { x: viewportSize.width / 2, y: viewportSize.height / 2 };
	}

	function viewportPoint(event: PointerEvent | WheelEvent | MouseEvent) {
		const bounds = viewportElement?.getBoundingClientRect();
		if (!bounds) return viewportCenter();
		return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
	}

	function normalizedImagePoint(point: Point) {
		const imagePoint = screenToImage(point, viewportSize, imageSize, viewportTransform);
		if (
			imagePoint.x < 0 ||
			imagePoint.y < 0 ||
			imagePoint.x > imageSize.width ||
			imagePoint.y > imageSize.height
		) {
			return null;
		}
		return { x: imagePoint.x / imageSize.width, y: imagePoint.y / imageSize.height };
	}

	function handleWheel(event: WheelEvent) {
		if (!active) return;
		event.preventDefault();
		const unit =
			event.deltaMode === WheelEvent.DOM_DELTA_LINE
				? 16
				: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
					? viewportSize.height
					: 1;
		const delta = { x: event.deltaX * unit, y: event.deltaY * unit };
		const navigation = wheelNavigation(delta, event);
		if (navigation.kind === 'pan') {
			viewportMode = 'manual';
			viewportTransform = panBy(viewportTransform, navigation.delta, viewportSize, imageSize);
			return;
		}
		const sensitivity = event.ctrlKey ? 0.008 : 0.0018;
		setZoom(
			viewportTransform.scale * Math.exp(-navigation.delta * sensitivity),
			viewportPoint(event)
		);
	}

	function handlePointerDown(event: PointerEvent) {
		if (!active || !viewportElement) return;
		const point = viewportPoint(event);

		if (event.pointerType === 'touch') {
			event.preventDefault();
			viewportElement.setPointerCapture(event.pointerId);
			pointers.set(event.pointerId, point);
			if (pointers.size >= 2) beginPinch();
			else beginPan(event.pointerId, point);
			return;
		}

		if (activeTool === 'zoom' && event.button === 0) {
			event.preventDefault();
			stepZoom(event.altKey ? -1 : 1, point);
			return;
		}

		if (activeTool === 'object-select' && event.button === 0) {
			const imagePoint = normalizedImagePoint(point);
			if (!imagePoint) return;
			event.preventDefault();
			viewportElement.setPointerCapture(event.pointerId);
			objectStroke = {
				pointerId: event.pointerId,
				label: event.altKey ? 'background' : 'foreground',
				points: [imagePoint]
			};
			return;
		}

		if (
			activeTool === 'mask-refine' &&
			event.button === 0 &&
			canRefineSelectedMask &&
			!smartMaskWorking
		) {
			const imagePoint = normalizedImagePoint(point);
			if (!imagePoint) return;
			event.preventDefault();
			viewportElement.setPointerCapture(event.pointerId);
			edgeRefinementStroke = {
				pointerId: event.pointerId,
				points: [imagePoint],
				radius: refineBrushRadius
			};
			return;
		}

		if (activeTool === 'hand' || spaceHeld || event.button === 1) {
			event.preventDefault();
			viewportElement.setPointerCapture(event.pointerId);
			beginPan(event.pointerId, point);
		}
	}

	function handlePointerMove(event: PointerEvent) {
		const point = viewportPoint(event);
		maskBrushPoint =
			activeTool === 'mask-refine' && event.pointerType !== 'touch'
				? normalizedImagePoint(point)
				: null;
		if (objectStroke?.pointerId === event.pointerId) {
			event.preventDefault();
			const imagePoint = normalizedImagePoint(point);
			const previous = objectStroke.points.at(-1);
			if (
				imagePoint &&
				(!previous || Math.hypot(imagePoint.x - previous.x, imagePoint.y - previous.y) > 0.003)
			) {
				objectStroke = { ...objectStroke, points: [...objectStroke.points, imagePoint] };
			}
			return;
		}
		if (edgeRefinementStroke?.pointerId === event.pointerId) {
			event.preventDefault();
			const imagePoint = normalizedImagePoint(point);
			const previous = edgeRefinementStroke.points.at(-1);
			if (
				imagePoint &&
				(!previous ||
					Math.hypot(imagePoint.x - previous.x, imagePoint.y - previous.y) >
						edgeRefinementStroke.radius / 4)
			) {
				edgeRefinementStroke = {
					...edgeRefinementStroke,
					points: [...edgeRefinementStroke.points, imagePoint]
				};
			}
			return;
		}
		if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);

		if (pinch && pointers.size >= 2) {
			const [first, second] = [...pointers.values()];
			if (!first || !second) return;
			const center = midpoint(first, second);
			const scale = pinch.transform.scale * (distance(first, second) / pinch.distance);
			const zoomed = zoomAt(pinch.transform, scale, pinch.origin, viewportSize, imageSize);
			viewportMode = 'manual';
			viewportTransform = panBy(
				zoomed,
				{ x: center.x - pinch.origin.x, y: center.y - pinch.origin.y },
				viewportSize,
				imageSize
			);
			return;
		}

		if (!drag || drag.pointerId !== event.pointerId) return;
		event.preventDefault();
		viewportMode = 'manual';
		viewportTransform = panBy(
			drag.transform,
			{ x: point.x - drag.origin.x, y: point.y - drag.origin.y },
			viewportSize,
			imageSize
		);
	}

	function handlePointerLeave() {
		maskBrushPoint = null;
	}

	function handlePointerUp(event: PointerEvent) {
		if (edgeRefinementStroke?.pointerId === event.pointerId) {
			const completed = edgeRefinementStroke;
			edgeRefinementStroke = null;
			if (event.type === 'pointerup') void workspace.refineMaskEdge(completed);
			return;
		}
		if (objectStroke?.pointerId === event.pointerId) {
			const completed = objectStroke;
			objectStroke = null;
			if (event.type === 'pointerup') {
				void workspace.paintObjectMask(completed.points, completed.label);
			}
			return;
		}
		const wasPinching = pinch !== null;
		pointers.delete(event.pointerId);
		if (drag?.pointerId === event.pointerId) drag = null;
		if (wasPinching && pointers.size === 1) {
			const [remaining] = pointers.entries();
			if (remaining) beginPan(...remaining);
		} else if (pointers.size < 2) {
			pinch = null;
		}
		panning = drag !== null || pinch !== null;
	}

	function handleDoubleClick(event: MouseEvent) {
		if (
			!active ||
			activeTool === 'zoom' ||
			activeTool === 'object-select' ||
			activeTool === 'mask-refine'
		) {
			return;
		}
		event.preventDefault();
		if (viewportMode === 'fit') setZoom(1, viewportPoint(event));
		else fitPhoto();
	}

	function beginPan(pointerId: number, origin: Point) {
		drag = { pointerId, origin, transform: viewportTransform };
		pinch = null;
		panning = true;
	}

	function beginPinch() {
		const [first, second] = [...pointers.values()];
		if (!first || !second) return;
		drag = null;
		pinch = {
			origin: midpoint(first, second),
			distance: Math.max(1, distance(first, second)),
			transform: viewportTransform
		};
		panning = true;
	}

	function midpoint(first: Point, second: Point) {
		return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
	}

	function distance(first: Point, second: Point) {
		return Math.hypot(second.x - first.x, second.y - first.y);
	}

	onMount(() =>
		tinykeys(window, {
			v: selectShortcut('move', 'move'),
			h: selectShortcut('hand', 'hand'),
			z: selectShortcut('zoom', 'zoom'),
			r: selectShortcut('rotate-view', 'rotate view'),
			w: cycleShortcut([
				['object-select', 'object selection'],
				['quick-select', 'quick selection'],
				['magic-wand', 'magic wand']
			]),
			m: cycleShortcut([
				['marquee', 'rectangular marquee'],
				['ellipse-marquee', 'elliptical marquee'],
				['single-row-marquee', 'single row marquee'],
				['single-column-marquee', 'single column marquee']
			]),
			l: cycleShortcut([
				['lasso', 'lasso'],
				['polygon-lasso', 'polygonal lasso'],
				['magnetic-lasso', 'magnetic lasso']
			]),
			c: cycleShortcut([
				['crop', 'crop'],
				['perspective-crop', 'perspective crop'],
				['slice', 'slice'],
				['slice-select', 'slice selection'],
				['frame', 'frame']
			]),
			j: cycleShortcut([
				['remove', 'remove'],
				['spot-heal', 'spot healing brush'],
				['healing-brush', 'healing brush'],
				['patch', 'patch'],
				['content-aware-move', 'content-aware move']
			]),
			s: cycleShortcut([
				['clone-stamp', 'clone stamp'],
				['pattern-stamp', 'pattern stamp']
			]),
			o: cycleShortcut([
				['dodge', 'dodge'],
				['burn', 'burn'],
				['sponge', 'sponge']
			]),
			b: cycleShortcut([
				['brush', 'brush'],
				['pencil', 'pencil'],
				['mixer-brush', 'mixer brush'],
				['color-replacement', 'color replacement']
			]),
			e: cycleShortcut([
				['eraser', 'eraser'],
				['background-eraser', 'background eraser'],
				['magic-eraser', 'magic eraser']
			]),
			y: cycleShortcut([
				['history-brush', 'history brush'],
				['art-history-brush', 'art history brush']
			]),
			g: cycleShortcut([
				['gradient', 'gradient'],
				['paint-bucket', 'paint bucket']
			]),
			i: cycleShortcut([
				['eyedropper', 'eyedropper'],
				['color-sampler', 'color sampler'],
				['ruler', 'ruler']
			]),
			p: cycleShortcut([
				['pen', 'pen'],
				['freeform-pen', 'freeform pen'],
				['curvature-pen', 'curvature pen']
			]),
			a: selectShortcut('path-select', 'path selection'),
			t: cycleShortcut([
				['type', 'horizontal type'],
				['vertical-type', 'vertical type'],
				['type-mask', 'type mask']
			]),
			u: cycleShortcut([
				['shape', 'rectangle'],
				['ellipse-shape', 'ellipse'],
				['triangle-shape', 'triangle'],
				['polygon-shape', 'polygon'],
				['star-shape', 'star'],
				['line-shape', 'line'],
				['custom-shape', 'custom shape']
			]),
			q: selectShortcut('mask', 'mask brush')
		})
	);

	onMount(() => {
		const element = viewportElement;
		if (!element) return;

		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const next = {
				width: entry.contentRect.width,
				height: entry.contentRect.height
			};
			viewportSize = next;
			viewportTransform =
				viewportMode === 'fit'
					? fittedTransform(next, imageSize)
					: clampTransform(viewportTransform, next, imageSize);
		});
		observer.observe(element);

		const handleKeyDown = (event: KeyboardEvent) => {
			if (!active || editableTarget(event.target)) return;
			if (event.code === 'Space') {
				event.preventDefault();
				spaceHeld = true;
				return;
			}
			if (event.key === '0') {
				event.preventDefault();
				fitPhoto();
			} else if (event.key === '1') {
				event.preventDefault();
				showActualPixels();
			} else if (event.key === '+' || event.key === '=') {
				event.preventDefault();
				stepZoom(1);
			} else if (event.key === '-' || event.key === '_') {
				event.preventDefault();
				stepZoom(-1);
			}
		};
		const handleKeyUp = (event: KeyboardEvent) => {
			if (event.code === 'Space') spaceHeld = false;
		};
		const handleBlur = () => {
			spaceHeld = false;
		};

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		window.addEventListener('blur', handleBlur);
		return () => {
			observer.disconnect();
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
			window.removeEventListener('blur', handleBlur);
		};
	});

	function editableTarget(target: EventTarget | null) {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function addMask(kind: MaskKind) {
		workspace.createMask(kind);
		activeTool = 'mask';
		activeToolLabel = 'mask brush';
		inspectorTab = 'mask';
		maskPreviewMode = 'overlay';
	}

	function beginObjectMask() {
		chooseTool('object-select', 'object selection');
		inspectorTab = 'mask';
		maskPreviewMode = 'overlay';
	}

	function beginEdgeRefinement() {
		if (!canRefineSelectedMask) return;
		chooseTool('mask-refine', 'refine edge');
		maskPreviewMode = 'overlay';
	}

	function developPhaseLabel(phase: DevelopPhase) {
		return {
			reading: 'reading originals',
			decoding: 'decoding raw',
			merging: 'aligning + merging',
			rendering: 'rendering preview'
		}[phase];
	}

	function developDetail(status: LoadingDocument) {
		switch (status.phase) {
			case 'reading':
				return status.totalBytes > 0
					? `${formatBytes(status.bytesRead)} / ${formatBytes(status.totalBytes)}`
					: 'locating originals';
			case 'decoding':
				return `frame ${status.activeFrame} / ${status.totalFrames}`;
			case 'merging':
				return status.totalFrames > 1 ? `${status.totalFrames} exposures` : 'building image';
			case 'rendering':
				return 'SDR preview';
		}
	}

	function developProgress(status: LoadingDocument) {
		if (status.phase === 'reading' && status.totalBytes > 0) {
			return (status.bytesRead / status.totalBytes) * 100;
		}
		if (status.phase === 'decoding' && status.totalFrames > 1) {
			return (status.framesDecoded / status.totalFrames) * 100;
		}
		return null;
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
			<div class="border-subtle bg-bg flex h-9 shrink-0 items-center justify-between border-b px-3">
				<div class="text-muted flex items-center gap-1">
					<Tooltip text="Fit image to view">
						{#snippet children(props)}
							<button
								{...props}
								type="button"
								aria-label="Fit image to view"
								class="hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded {viewportMode ===
								'fit'
									? 'text-accent'
									: ''}"
								onclick={fitPhoto}
							>
								<Maximize2 size={12} />
							</button>
						{/snippet}
					</Tooltip>
					<button
						type="button"
						aria-label="Zoom out"
						class="hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded"
						onclick={zoomOut}
					>
						<Minus size={12} />
					</button>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							aria-label="Choose zoom level"
							class="hover:bg-surface hover:text-text flex h-6 min-w-12 cursor-pointer items-center justify-center rounded px-1 font-mono text-[10px] tabular-nums outline-none"
						>
							{formatZoom(viewportTransform.scale)}
						</DropdownMenu.Trigger>
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								align="start"
								sideOffset={4}
								class="motion-menu border-subtle bg-bg z-50 min-w-36 rounded border p-1 shadow-2xl"
							>
								<DropdownMenu.Item class={zoomMenuItemClass} onSelect={fitPhoto}>
									<span class="text-accent w-3">{viewportMode === 'fit' ? '•' : ''}</span>
									<span class="flex-1">fit</span>
									<kbd class="text-muted font-mono text-[9px]">0</kbd>
								</DropdownMenu.Item>
								<DropdownMenu.Item class={zoomMenuItemClass} onSelect={showActualPixels}>
									<span class="text-accent w-3"
										>{viewportMode === 'manual' && Math.abs(viewportTransform.scale - 1) < 0.0001
											? '•'
											: ''}</span
									>
									<span class="flex-1">actual pixels</span>
									<kbd class="text-muted font-mono text-[9px]">1</kbd>
								</DropdownMenu.Item>
								<DropdownMenu.Separator class="bg-subtle my-1 h-px" />
								{#each ZOOM_MENU_PRESETS as scale}
									<DropdownMenu.Item class={zoomMenuItemClass} onSelect={chooseZoom(scale)}>
										<span class="text-accent w-3"
											>{viewportMode === 'manual' &&
											Math.abs(viewportTransform.scale - scale) < 0.0001
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
						onclick={zoomIn}
					>
						<Plus size={12} />
					</button>
				</div>

				{#if active}
					<p class="text-muted max-w-64 truncate font-mono text-[10px] tracking-wide">
						{active.name}
					</p>
				{/if}

				<!-- TODO(WASM_TODOS.previewRendering): switch between original and rendered Wasm output. -->
				<button
					type="button"
					class="border-subtle text-muted hover:text-text flex h-6 cursor-pointer items-center gap-1.5 rounded border px-2 text-[10px] transition-colors"
					onclick={() => (before = !before)}
				>
					<Columns2 size={11} />
					{before ? 'before' : 'after'}
				</button>
			</div>

			<div
				class="border-subtle bg-bg text-muted flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 text-[10px]"
			>
				<span class="text-text shrink-0 font-medium">{activeToolLabel}</span>
				<span class="bg-subtle h-4 w-px shrink-0"></span>

				{#if activeTool === 'object-select'}
					<span class="shrink-0">paint to include</span>
					<span class="text-muted shrink-0">
						<kbd class="text-text font-mono">alt</kbd> paint to exclude
					</span>
				{:else if selectionTools.has(activeTool)}
					<!-- TODO(WASM_TODOS.editorTools): implement remaining pixel selection tools. -->
					<div class="border-subtle bg-surface flex h-6 shrink-0 rounded border p-0.5">
						{#each ['new', 'add', 'subtract', 'intersect'] as mode, index}
							<button
								type="button"
								title={`${mode} selection`}
								class="hover:bg-elevated hover:text-text flex min-w-6 cursor-pointer items-center justify-center rounded-sm px-1.5 {index ===
								0
									? 'bg-elevated text-text'
									: ''}"
							>
								{mode === 'new' ? '□' : mode === 'add' ? '+' : mode === 'subtract' ? '−' : '∩'}
							</button>
						{/each}
					</div>
					{#if activeTool === 'magic-wand'}
						<span class="shrink-0">tolerance <span class="text-text font-mono">32</span></span>
					{/if}
					<span class="shrink-0">feather <span class="text-text font-mono">0 px</span></span>
					<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
						<input type="checkbox" checked class="accent-accent size-3" /> anti-alias
					</label>
					{#if activeTool === 'magic-wand'}
						<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
							<input type="checkbox" checked class="accent-accent size-3" /> contiguous
						</label>
					{/if}
				{:else if cropTools.has(activeTool)}
					<button
						type="button"
						class="border-subtle bg-surface text-text h-6 shrink-0 cursor-pointer rounded border px-2"
					>
						original ratio
					</button>
					<span class="shrink-0 font-mono">— × —</span>
					<button
						type="button"
						class="hover:bg-surface hover:text-text flex size-6 shrink-0 cursor-pointer items-center justify-center rounded"
						aria-label="Straighten"
					>
						<RotateCcw size={12} />
					</button>
					<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
						<input type="checkbox" class="accent-accent size-3" /> delete cropped pixels
					</label>
				{:else if retouchTools.has(activeTool) || paintTools.has(activeTool)}
					<button
						type="button"
						class="border-subtle bg-surface text-text flex h-6 shrink-0 cursor-pointer items-center gap-2 rounded border px-2"
					>
						<span class="size-3 rounded-full border border-current"></span>
						<span class="font-mono">42 px</span>
					</button>
					<span class="shrink-0">hardness <span class="text-text font-mono">65%</span></span>
					<span class="shrink-0">opacity <span class="text-text font-mono">100%</span></span>
					{#if ['brush', 'pencil', 'mixer-brush'].includes(activeTool)}
						<span class="shrink-0">flow <span class="text-text font-mono">100%</span></span>
					{:else}
						<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
							<input type="checkbox" checked class="accent-accent size-3" /> sample all layers
						</label>
					{/if}
				{:else if typeTools.has(activeTool)}
					<button class="border-subtle bg-surface text-text h-6 shrink-0 rounded border px-2">
						Overused Grotesk
					</button>
					<span class="shrink-0 font-mono">32 px</span>
					<span class="shrink-0">regular</span>
					<div class="border-subtle bg-surface size-4 shrink-0 rounded-sm border"></div>
				{:else if vectorTools.has(activeTool)}
					<button class="border-subtle bg-surface text-text h-6 shrink-0 rounded border px-2">
						path
					</button>
					<span class="shrink-0">fill</span>
					<div class="border-subtle bg-text size-4 shrink-0 rounded-sm border"></div>
					<span class="shrink-0">stroke <span class="text-text font-mono">1 px</span></span>
				{:else if measureTools.has(activeTool)}
					<span class="shrink-0">sample <span class="text-text font-mono">5 × 5</span></span>
					<span class="shrink-0">scale <span class="text-text font-mono">1 px : 1 px</span></span>
				{:else if generativeTools.has(activeTool)}
					<!-- TODO(WASM_TODOS.generative): run the provider and composite through the planned binding. -->
					<input
						placeholder="describe an edit"
						class="border-subtle bg-surface placeholder:text-muted/60 focus:border-accent h-6 min-w-48 rounded border px-2 focus:outline-none"
					/>
					<button class="bg-text text-bg h-6 shrink-0 cursor-pointer rounded px-2">generate</button>
				{:else if activeTool.startsWith('mask')}
					<span class="shrink-0"
						>size <span class="text-text font-mono"
							>{activeTool === 'mask-refine' ? refineBrushSize : 42} px</span
						></span
					>
					<span class="shrink-0">feather <span class="text-text font-mono">45%</span></span>
					<span class="shrink-0">flow <span class="text-text font-mono">100%</span></span>
				{:else}
					<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
						<input type="checkbox" checked class="accent-accent size-3" /> auto-select
					</label>
					<label class="flex shrink-0 cursor-pointer items-center gap-1.5">
						<input type="checkbox" class="accent-accent size-3" /> show transform controls
					</label>
				{/if}
			</div>

			<div
				bind:this={viewportElement}
				role="application"
				aria-label="Photo viewport"
				class="relative isolate min-h-0 flex-1 touch-none overflow-hidden [contain:paint] {panning
					? 'cursor-grabbing'
					: activeTool === 'hand' || spaceHeld
						? 'cursor-grab'
						: activeTool === 'zoom'
							? 'cursor-zoom-in'
							: activeTool === 'mask-refine' && maskBrushPoint
								? 'cursor-none'
								: activeTool === 'object-select' || activeTool === 'mask-refine'
									? 'cursor-crosshair'
									: 'cursor-default'}"
				onwheel={handleWheel}
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerleave={handlePointerLeave}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
				onlostpointercapture={handlePointerUp}
				ondblclick={handleDoubleClick}
			>
				<div
					class="pointer-events-none absolute inset-0 [background-image:radial-gradient(#3c3a34_0.7px,transparent_0.7px)] [background-size:8px_8px] opacity-20"
				></div>
				{#if active}
					{#key `${active.id}:${active.src}`}
						<div
							class:viewport-pixelated={pixelGridStrength > 0}
							class="motion-viewport-photo absolute top-0 left-0 z-0 overflow-hidden bg-black shadow-2xl will-change-transform"
							style={`width: ${imageSize.width}px; height: ${imageSize.height}px; transform: translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) scale(${viewportTransform.scale}); transform-origin: top left; --viewport-scale: ${viewportTransform.scale};`}
						>
							<PhotoVisual photo={active} contain onRequest={workspace.loadThumbnail} />
							{#if workspace.documentStatus.kind === 'loading' && workspace.documentStatus.photoId === active.id && workspace.documentStatus.phase !== 'reading'}
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
							enabled={workspace.documentStatus.kind === 'ready' &&
								workspace.documentStatus.photoId === active.id}
							viewport={viewportSize}
							image={imageSize}
							transform={viewportTransform}
							renderTile={workspace.renderTile}
							renderRevision={workspace.renderSettings.revision}
							settings={workspace.renderSettings.settings}
							onRenderSettled={workspace.settleDevelopRender}
						/>
						{#if workspace.developPreview?.photoId === active.id}
							<div
								class="motion-viewport-photo pointer-events-none absolute top-0 left-0 z-[15] overflow-hidden will-change-transform"
								class:bg-black={workspace.developPreview.src !== null}
								style={`width: ${imageSize.width}px; height: ${imageSize.height}px; transform: translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) scale(${viewportTransform.scale}); transform-origin: top left; --viewport-scale: ${viewportTransform.scale};`}
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
							<div
								class="border-subtle bg-bg/90 text-muted pointer-events-none absolute bottom-3 left-1/2 z-30 w-36 -translate-x-1/2 overflow-hidden rounded border px-2 py-1.5 text-[9px] shadow-lg backdrop-blur"
							>
								<span>
									{workspace.developPreview.phase === 'refining'
										? 'refining tiles'
										: 'applying light'}
								</span>
								<div class="bg-subtle mt-1 h-px overflow-hidden">
									<div class="develop-progress-sweep bg-text h-full w-1/3"></div>
								</div>
							</div>
						{/if}
						<div
							class="pointer-events-none absolute top-0 left-0 z-20 overflow-hidden will-change-transform"
							style={`width: ${imageSize.width}px; height: ${imageSize.height}px; transform: translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) scale(${viewportTransform.scale}); transform-origin: top left; --viewport-scale: ${viewportTransform.scale};`}
						>
							{#if pixelGridStrength > 0}
								<div
									data-pixel-grid
									class="viewport-pixel-grid pointer-events-none absolute inset-0"
									style:opacity={pixelGridStrength}
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
							{#if selectedMask?.visible && maskPreviewMode && workspace.selectedMaskRaster?.maskId === selectedMask.id}
								{#key maskPreviewMode}
									<MaskOverlay raster={workspace.selectedMaskRaster} mode={maskPreviewMode} />
								{/key}
							{/if}
							{#if objectStroke}
								<MaskPromptOverlay
									points={objectStroke.points}
									label={objectStroke.label}
									imageWidth={imageSize.width}
									imageHeight={imageSize.height}
									viewportScale={viewportTransform.scale}
								/>
							{/if}
							{#if edgeRefinementStroke}
								<MaskPromptOverlay
									points={edgeRefinementStroke.points}
									label="refine"
									brushRadius={edgeRefinementStroke.radius}
									imageWidth={imageSize.width}
									imageHeight={imageSize.height}
									viewportScale={viewportTransform.scale}
								/>
							{/if}
							{#if activeTool === 'mask-refine' && maskBrushPoint && !smartMaskWorking}
								<MaskBrushCursor
									point={maskBrushPoint}
									radius={edgeRefinementStroke?.radius ?? refineBrushRadius}
									imageWidth={imageSize.width}
									imageHeight={imageSize.height}
									viewportScale={viewportTransform.scale}
								/>
							{/if}
						</div>
					{/key}
					{#if before}
						<span
							class="pointer-events-none absolute top-3 left-3 rounded-sm bg-black/65 px-2 py-1 text-[10px] tracking-wide text-white backdrop-blur"
						>
							before
						</span>
					{/if}
					{#if workspace.documentStatus.kind === 'loading' && workspace.documentStatus.photoId === active.id}
						<div
							class="pointer-events-none absolute right-3 bottom-3 left-3 flex justify-center text-white"
						>
							<div
								class="motion-enter pointer-events-auto w-full max-w-72 rounded border border-white/10 bg-black/70 px-3 py-2.5 shadow-xl backdrop-blur-md"
							>
								<div class="flex min-w-0 items-center gap-2">
									<p class="min-w-0 flex-1 truncate text-[10px]">
										{developPhaseLabel(workspace.documentStatus.phase)}
										<span class="font-mono text-[9px] text-white/40 tabular-nums">
											· {developDetail(workspace.documentStatus)}
										</span>
									</p>
									<button
										type="button"
										class="cursor-pointer text-[9px] text-white/40 transition-colors hover:text-white"
										onclick={workspace.cancelDocument}
									>
										cancel
									</button>
								</div>
								<div class="relative mt-2 h-0.5 overflow-hidden rounded-full bg-white/10">
									{#if developProgress(workspace.documentStatus) !== null}
										<div
											class="bg-accent absolute inset-y-0 left-0 rounded-full transition-[width] duration-200"
											style:width={`${developProgress(workspace.documentStatus)}%`}
										></div>
									{/if}
									<div class="develop-progress-sweep absolute inset-y-0 w-1/3"></div>
								</div>
							</div>
						</div>
					{/if}
					{#if workspace.documentStatus.kind === 'cancelled' && workspace.documentStatus.photoId === active.id}
						<div
							class="absolute inset-0 z-20 flex items-center justify-center bg-black/50 px-6 text-center text-white backdrop-blur-[1px]"
						>
							<div class="motion-enter flex flex-col items-center gap-2.5">
								<p class="text-[11px]">development stopped</p>
								<button
									type="button"
									class="cursor-pointer rounded border border-white/20 px-2.5 py-1 text-[10px] transition-colors hover:bg-white/10"
									onclick={workspace.reloadDocument}
								>
									retry
								</button>
							</div>
						</div>
					{:else if workspace.documentStatus.kind === 'error' && workspace.documentStatus.photoId === active.id}
						<div
							class="absolute inset-0 z-20 flex items-center justify-center bg-black/60 px-6 text-center text-white backdrop-blur-[1px]"
						>
							<div class="motion-enter flex max-w-72 flex-col items-center gap-2.5">
								<p class="text-[11px]">couldn't open raw</p>
								<p class="text-[9px] leading-relaxed text-white/55">
									{workspace.documentStatus.message}
								</p>
								<button
									type="button"
									class="mt-1 cursor-pointer rounded border border-white/20 px-2.5 py-1 text-[10px] transition-colors hover:bg-white/10"
									onclick={workspace.reloadDocument}
								>
									retry
								</button>
							</div>
						</div>
					{/if}
				{:else}
					<p class="text-muted absolute inset-0 flex items-center justify-center text-[10px]">
						select a photo in organize.
					</p>
				{/if}
			</div>

			<footer
				class="border-subtle bg-bg text-muted flex h-7 shrink-0 items-center justify-between border-t px-3 text-[10px] tracking-wide"
			>
				<span>display · SDR preview</span>
				{#if active}
					<output
						title="Visible source pixels · full image pixels"
						aria-label={`Viewing ${Math.round(visiblePixels.width)} by ${Math.round(visiblePixels.height)} of ${imageSize.width} by ${imageSize.height} source pixels`}
						class="flex items-baseline gap-1 whitespace-nowrap"
					>
						<span>view</span>
						<span class="font-mono tabular-nums"
							>{Math.round(visiblePixels.width)} × {Math.round(visiblePixels.height)}</span
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
						class="text-muted data-[state=active]:border-text data-[state=active]:text-text cursor-pointer border-b border-transparent text-[10px] tracking-[0.03em]"
					>
						adjust
					</Tabs.Trigger>
					<Tabs.Trigger
						value="mask"
						class="text-muted data-[state=active]:border-text data-[state=active]:text-text cursor-pointer border-b border-transparent text-[10px] tracking-[0.03em]"
					>
						mask {#if workspace.masks.length > 0}<span class="text-accent ml-1"
								>{workspace.masks.length}</span
							>{/if}
					</Tabs.Trigger>
					<Tabs.Trigger
						value="layers"
						class="text-muted data-[state=active]:border-text data-[state=active]:text-text cursor-pointer border-b border-transparent text-[10px] tracking-[0.03em]"
					>
						layers
					</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="adjust" class="motion-tab">
					<div class="border-subtle border-b p-3">
						<ImageScope
							data={workspace.imageScope}
							loading={workspace.documentStatus.kind === 'loading'}
						/>
					</div>

					<Panel title="Profile" meta="Camera look">
						<button
							type="button"
							class="border-subtle bg-surface text-text/80 hover:border-muted flex h-8 w-full cursor-pointer items-center justify-between rounded border px-2 text-[11px]"
						>
							<span>camera standard</span><span class="text-muted font-mono text-[10px]">PF</span>
						</button>
					</Panel>

					<Panel title="Light">
						<AdjustmentSlider
							label="Exposure"
							bind:value={workspace.adjustments.exposure}
							min={-4}
							max={4}
							step={0.05}
							decimals={2}
							suffix=" EV"
							disabled={!workspace.canAdjustLight}
							onValueChange={previewLight('exposure')}
							onValueCommit={commitLight('exposure')}
						/>
						<AdjustmentSlider
							label="Contrast"
							bind:value={workspace.adjustments.contrast}
							min={-100}
							max={100}
							disabled={!workspace.canAdjustLight}
							onValueChange={previewLight('contrast')}
							onValueCommit={commitLight('contrast')}
						/>
						<AdjustmentSlider
							label="Highlights"
							bind:value={workspace.adjustments.highlights}
							min={-100}
							max={100}
							disabled={!workspace.canAdjustLight}
							onValueChange={previewLight('highlights')}
							onValueCommit={commitLight('highlights')}
						/>
						<AdjustmentSlider
							label="Shadows"
							bind:value={workspace.adjustments.shadows}
							min={-100}
							max={100}
							disabled={!workspace.canAdjustLight}
							onValueChange={previewLight('shadows')}
							onValueCommit={commitLight('shadows')}
						/>
						<AdjustmentSlider
							label="Whites"
							bind:value={workspace.adjustments.whites}
							min={-100}
							max={100}
							disabled={!workspace.canAdjustLight}
							onValueChange={previewLight('whites')}
							onValueCommit={commitLight('whites')}
						/>
						<AdjustmentSlider
							label="Blacks"
							bind:value={workspace.adjustments.blacks}
							min={-100}
							max={100}
							disabled={!workspace.canAdjustLight}
							onValueChange={previewLight('blacks')}
							onValueCommit={commitLight('blacks')}
						/>
					</Panel>

					<Panel title="Color">
						<AdjustmentSlider
							label="Temperature"
							bind:value={workspace.adjustments.temperature}
							min={2000}
							max={12000}
							step={50}
							defaultValue={5600}
							suffix="K"
							signed={false}
						/>
						<AdjustmentSlider
							label="Tint"
							bind:value={workspace.adjustments.tint}
							min={-150}
							max={150}
						/>
						<AdjustmentSlider
							label="Vibrance"
							bind:value={workspace.adjustments.vibrance}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Saturation"
							bind:value={workspace.adjustments.saturation}
							min={-100}
							max={100}
						/>
						<button
							type="button"
							class="border-subtle text-muted hover:text-text mt-2 flex w-full cursor-pointer items-center justify-between rounded border px-2 py-2 text-[10px]"
						>
							color mixer <SlidersHorizontal size={12} />
						</button>
					</Panel>

					<Panel title="Presence" open={false}>
						<AdjustmentSlider
							label="Texture"
							bind:value={workspace.adjustments.texture}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Clarity"
							bind:value={workspace.adjustments.clarity}
							min={-100}
							max={100}
						/>
						<AdjustmentSlider
							label="Dehaze"
							bind:value={workspace.adjustments.dehaze}
							min={-100}
							max={100}
						/>
					</Panel>

					<Panel title="Detail" open={false}>
						<AdjustmentSlider
							label="Sharpening"
							bind:value={workspace.adjustments.sharpening}
							min={0}
							max={100}
							defaultValue={40}
							signed={false}
						/>
						<AdjustmentSlider
							label="Noise reduction"
							bind:value={workspace.adjustments.noiseReduction}
							min={0}
							max={100}
							defaultValue={10}
							signed={false}
						/>
					</Panel>

					<Panel title="Optics" open={false}>
						<label class="text-muted flex cursor-pointer items-center gap-2 py-1 text-[10px]">
							<input type="checkbox" checked class="accent-accent" /> remove chromatic aberration
						</label>
						<label class="text-muted flex cursor-pointer items-center gap-2 py-1 text-[10px]">
							<input type="checkbox" checked class="accent-accent" /> use lens profile
						</label>
					</Panel>

					<Panel title="Presets" open={false}>
						<div class="space-y-1">
							{#each ['Clean color', 'Soft highlight', 'Neutral portrait', 'Cinematic dusk'] as preset}
								<button
									type="button"
									class="text-muted hover:bg-surface hover:text-text flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[10px] lowercase"
								>
									<Sparkles size={11} />
									{preset}
								</button>
							{/each}
						</div>
					</Panel>

					<Panel title="History" open={false} meta={`${workspace.history.length}`}>
						<div class="border-subtle space-y-2 border-l pl-3">
							{#each [...workspace.history].reverse() as item, index}
								<div
									class="flex items-center gap-2 text-[10px] lowercase {index === 0
										? 'text-text'
										: 'text-muted'}"
								>
									<History size={10} />
									{item}
								</div>
							{/each}
						</div>
					</Panel>
				</Tabs.Content>

				<Tabs.Content value="mask" class="motion-tab">
					<div class="border-subtle border-b p-3">
						<p class="text-muted mb-2 text-[10px] tracking-[0.03em]">new mask</p>
						<div class="grid grid-cols-3 gap-1.5">
							<button type="button" class="mask-choice" onclick={() => addMask('brush')}
								><Brush size={15} /><span>brush</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('linear')}
								><Blend size={15} /><span>linear</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('radial')}
								><CircleDashed size={15} /><span>radial</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('subject')}
								><UserRound size={15} /><span>subject</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('sky')}
								><CloudSun size={15} /><span>sky</span></button
							>
							<button type="button" class="mask-choice" onclick={() => addMask('background')}
								><Mountain size={15} /><span>background</span></button
							>
							<button type="button" class="mask-choice" onclick={beginObjectMask}
								><Scan size={15} /><span>object</span></button
							>
						</div>
						{#if smartMaskWorking || workspace.smartMaskStatus.error}
							<div class="border-subtle bg-surface mt-2 overflow-hidden rounded border px-2 py-1.5">
								<p
									class="truncate text-[9px] {workspace.smartMaskStatus.error
										? 'text-negative'
										: 'text-muted'}"
								>
									{workspace.smartMaskStatus.detail}
								</p>
								{#if smartMaskWorking}
									<div class="bg-subtle mt-1 h-px overflow-hidden">
										<div
											class="bg-text h-full transition-[width] duration-200"
											class:develop-progress-sweep={workspace.smartMaskStatus.progress === null}
											style:width={workspace.smartMaskStatus.progress === null
												? '33%'
												: `${workspace.smartMaskStatus.progress}%`}
										></div>
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<div class="border-subtle border-b p-3">
						<div class="mb-2 flex items-center justify-between">
							<p class="text-muted text-[10px] tracking-[0.03em]">layers</p>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									aria-label="Choose mask preview"
									class="text-muted hover:bg-surface hover:text-text flex h-6 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[9px] lowercase outline-none"
								>
									{#if maskPreviewMode}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
									<span>{maskPreviewMode ?? 'off'}</span>
								</DropdownMenu.Trigger>
								<DropdownMenu.Portal>
									<DropdownMenu.Content
										align="end"
										sideOffset={4}
										class="motion-menu border-subtle bg-bg z-50 min-w-28 rounded border p-1 shadow-2xl"
									>
										{#each MASK_PREVIEW_MODES as mode}
											<DropdownMenu.Item
												class={zoomMenuItemClass}
												onSelect={chooseMaskPreview(mode)}
											>
												<span class="text-accent w-3">{maskPreviewMode === mode ? '•' : ''}</span>
												<span>{mode}</span>
											</DropdownMenu.Item>
										{/each}
										<DropdownMenu.Separator class="bg-subtle my-1 h-px" />
										<DropdownMenu.Item class={zoomMenuItemClass} onSelect={chooseMaskPreview(null)}>
											<span class="text-accent w-3">{maskPreviewMode === null ? '•' : ''}</span>
											<span>off</span>
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Portal>
							</DropdownMenu.Root>
						</div>
						<div class="space-y-1">
							{#each workspace.masks as mask (mask.id)}
								<div
									role="button"
									tabindex="0"
									class="group flex w-full cursor-pointer items-center gap-2 rounded border px-2 py-2 text-left {workspace.selectedMaskId ===
									mask.id
										? 'border-accent bg-surface'
										: 'hover:bg-surface/65 border-transparent'}"
									onclick={() => workspace.selectMask(mask.id)}
									onkeydown={(event) => event.key === 'Enter' && workspace.selectMask(mask.id)}
								>
									<span
										class="bg-elevated text-muted flex size-7 items-center justify-center rounded-sm"
										><Scan size={13} /></span
									>
									<span class="min-w-0 flex-1 truncate text-[10px] lowercase">{mask.name}</span>
									<button
										type="button"
										aria-label={mask.visible ? 'Hide mask' : 'Show mask'}
										class="text-muted hover:text-text cursor-pointer"
										onclick={(event) => {
											event.stopPropagation();
											workspace.toggleMask(mask.id);
										}}
									>
										{#if mask.visible}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
									</button>
									<button
										type="button"
										aria-label="Delete mask"
										class="text-muted hover:text-negative cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100"
										onclick={(event) => {
											event.stopPropagation();
											workspace.deleteMask(mask.id);
										}}
									>
										<Trash2 size={12} />
									</button>
								</div>
							{/each}
							{#if workspace.masks.length === 0}
								<div class="border-subtle rounded border border-dashed px-3 py-5 text-center">
									<CircleDashed size={18} strokeWidth={1} class="text-muted mx-auto mb-2" />
									<p class="text-muted text-[10px]">choose a tool to create a mask.</p>
								</div>
							{/if}
						</div>
					</div>

					{#if selectedMask}
						<Panel title="Mask adjustments" meta={selectedMask.name}>
							{#if selectedObjectComponent?.alternatives && selectedObjectComponent.alternatives.count > 1}
								<div
									class="border-subtle mb-2 flex h-8 items-center justify-between rounded border px-1"
								>
									<button
										type="button"
										aria-label="Previous object candidate"
										disabled={smartMaskWorking}
										class="text-muted hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded disabled:cursor-default disabled:opacity-40"
										onclick={() => workspace.cycleObjectMaskCandidate(-1)}
									>
										<ChevronLeft size={12} />
									</button>
									<span class="text-muted text-[9px] lowercase">
										candidate
										<span class="text-text font-mono"
											>{selectedObjectComponent.alternatives.index + 1}/{selectedObjectComponent
												.alternatives.count}</span
										>
									</span>
									<button
										type="button"
										aria-label="Next object candidate"
										disabled={smartMaskWorking}
										class="text-muted hover:bg-surface hover:text-text flex size-6 cursor-pointer items-center justify-center rounded disabled:cursor-default disabled:opacity-40"
										onclick={() => workspace.cycleObjectMaskCandidate(1)}
									>
										<ChevronRight size={12} />
									</button>
								</div>
							{/if}
							<p class="text-muted pb-1 text-[9px] tracking-[0.03em] lowercase">edge</p>
							<AdjustmentSlider
								label="Definition"
								value={selectedMask.edge.contrast}
								min={0}
								max={100}
								signed={false}
								disabled={selectedMask.components.length === 0}
								onValueChange={previewMaskEdge('contrast')}
								onValueCommit={commitMaskEdge('contrast')}
							/>
							<AdjustmentSlider
								label="Feather"
								value={selectedMask.edge.feather}
								min={0}
								max={100}
								suffix=" px"
								signed={false}
								disabled={selectedMask.components.length === 0}
								onValueChange={previewMaskEdge('feather')}
								onValueCommit={commitMaskEdge('feather')}
							/>
							<AdjustmentSlider
								label="Shift"
								value={selectedMask.edge.shift}
								min={-100}
								max={100}
								suffix=" px"
								disabled={selectedMask.components.length === 0}
								onValueChange={previewMaskEdge('shift')}
								onValueCommit={commitMaskEdge('shift')}
							/>
							<button
								type="button"
								disabled={!canRefineSelectedMask || smartMaskWorking}
								class="border-subtle text-muted hover:border-muted hover:text-text mt-1 flex h-8 w-full cursor-pointer items-center justify-between rounded border px-2 text-[10px] lowercase transition-colors disabled:cursor-default disabled:opacity-40 {activeTool ===
								'mask-refine'
									? 'border-accent bg-surface text-text'
									: ''}"
								onclick={beginEdgeRefinement}
							>
								<span class="flex items-center gap-2"><Brush size={12} /> refine edge</span>
								<span>{activeTool === 'mask-refine' ? 'paint boundary' : 'brush'}</span>
							</button>
							{#if activeTool === 'mask-refine'}
								<div class="motion-enter pt-1">
									<AdjustmentSlider
										label="Brush"
										bind:value={refineBrushSize}
										min={8}
										max={200}
										defaultValue={42}
										suffix=" px"
										signed={false}
									/>
								</div>
							{/if}
							<div class="bg-subtle my-2 h-px"></div>
							<p class="text-muted pb-1 text-[9px] tracking-[0.03em] lowercase">light</p>
							<AdjustmentSlider
								label="Exposure"
								value={selectedMask.adjustments.light.exposure}
								min={-4}
								max={4}
								step={0.05}
								decimals={2}
								suffix=" EV"
								disabled={selectedMask.components.length === 0}
								onValueChange={previewMaskLight('exposure')}
								onValueCommit={commitMaskLight('exposure')}
							/>
							<AdjustmentSlider
								label="Contrast"
								value={selectedMask.adjustments.light.contrast}
								min={-100}
								max={100}
								disabled={selectedMask.components.length === 0}
								onValueChange={previewMaskLight('contrast')}
								onValueCommit={commitMaskLight('contrast')}
							/>
							<AdjustmentSlider
								label="Highlights"
								value={selectedMask.adjustments.light.highlights}
								min={-100}
								max={100}
								disabled={selectedMask.components.length === 0}
								onValueChange={previewMaskLight('highlights')}
								onValueCommit={commitMaskLight('highlights')}
							/>
							<AdjustmentSlider
								label="Shadows"
								value={selectedMask.adjustments.light.shadows}
								min={-100}
								max={100}
								disabled={selectedMask.components.length === 0}
								onValueChange={previewMaskLight('shadows')}
								onValueCommit={commitMaskLight('shadows')}
							/>
							<AdjustmentSlider
								label="Whites"
								value={selectedMask.adjustments.light.whites}
								min={-100}
								max={100}
								disabled={selectedMask.components.length === 0}
								onValueChange={previewMaskLight('whites')}
								onValueCommit={commitMaskLight('whites')}
							/>
							<AdjustmentSlider
								label="Blacks"
								value={selectedMask.adjustments.light.blacks}
								min={-100}
								max={100}
								disabled={selectedMask.components.length === 0}
								onValueChange={previewMaskLight('blacks')}
								onValueCommit={commitMaskLight('blacks')}
							/>
						</Panel>
					{/if}
				</Tabs.Content>

				<Tabs.Content value="layers" class="motion-tab">
					<!-- TODO(WASM_TODOS.layersAndHistory): back this panel with document layers and history. -->
					<div class="border-subtle flex items-center gap-2 border-b p-2">
						<select
							aria-label="Layer blend mode"
							class="border-subtle bg-surface text-text h-7 min-w-0 flex-1 cursor-pointer rounded border px-2 text-[10px] focus:outline-none"
						>
							<option>normal</option>
							<option>multiply</option>
							<option>screen</option>
							<option>overlay</option>
							<option>soft light</option>
						</select>
						<span class="text-muted text-[10px]">opacity</span>
						<span class="font-mono text-[10px]">100%</span>
					</div>

					<div class="space-y-1 p-2">
						<div class="border-accent bg-surface flex h-11 items-center gap-2 rounded border px-2">
							<Eye size={12} class="text-muted shrink-0" />
							<div
								class="bg-elevated text-muted flex size-7 shrink-0 items-center justify-center rounded-sm"
							>
								<SlidersHorizontal size={12} />
							</div>
							<span class="min-w-0 flex-1 truncate text-[10px]">color & tone</span>
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
								<span class="min-w-0 flex-1 truncate text-[10px]">{mask.name}</span>
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
							<span class="min-w-0 flex-1 truncate font-mono text-[10px]">
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
			</Tabs.Root>
		</aside>
	</div>

	<section class="motion-panel-up border-subtle bg-bg flex h-24 shrink-0 border-t">
		<div class="border-subtle text-muted flex w-11 shrink-0 items-center justify-center border-r">
			<ImageDown size={13} strokeWidth={1.25} />
		</div>
		<div class="flex min-w-0 flex-1 gap-2 overflow-x-auto p-2">
			{#each workspace.photos as photo, index (photo.id)}
				<button
					type="button"
					class="motion-card group bg-canvas relative w-24 shrink-0 cursor-pointer overflow-hidden rounded border {workspace.activePhotoId ===
					photo.id
						? 'border-accent'
						: 'border-subtle hover:border-muted'}"
					style={`--motion-delay: ${Math.min(index, 12) * 24}ms`}
					onclick={() => workspace.selectPhoto(photo.id)}
				>
					<PhotoVisual {photo} onRequest={workspace.loadThumbnail} />
					<span
						class="absolute top-1 left-1 rounded-sm bg-black/65 px-1 font-mono text-[10px] text-white"
						>{index + 1}</span
					>
					<span
						class="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1 py-0.5 font-mono text-[10px] text-white/80"
						>{photo.name}</span
					>
				</button>
			{/each}
		</div>
	</section>
</div>

<style>
	.mask-choice {
		display: flex;
		min-height: 3.5rem;
		cursor: pointer;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		border: 1px solid var(--color-subtle);
		border-radius: 0.25rem;
		background: var(--color-surface);
		color: var(--color-muted);
		font-size: 0.625rem;
		transition:
			color 150ms ease,
			border-color 150ms ease;
	}

	.mask-choice:hover {
		border-color: var(--color-muted);
		color: var(--color-text);
	}
</style>

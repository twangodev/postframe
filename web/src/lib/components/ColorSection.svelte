<script lang="ts">
	import { Pipette, SlidersHorizontal } from '@lucide/svelte';
	import AdjustmentSliders from './ui/AdjustmentSliders.svelte';
	import CameraMatchDialog from './CameraMatchDialog.svelte';
	import Panel from './ui/Panel.svelte';
	import type { ControlRevealPhase } from '$lib/adjustment-reveal';
	import type { ColorControlName } from '$lib/develop-settings';
	import { COLOR_SLIDERS } from '$lib/develop-sliders';
	import type { CameraMatchPreference } from '$lib/camera-match';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		activeTool: string;
		onPickTool: (tool: string) => void;
		onOpenMixer: () => void;
		open?: boolean;
		reveals?: Partial<Record<ColorControlName, ControlRevealPhase>>;
		onRevealInteraction?: (control: ColorControlName) => void;
	}

	let {
		workspace,
		activeTool,
		onPickTool,
		onOpenMixer,
		open = $bindable(true),
		reveals = {},
		onRevealInteraction = () => {}
	}: Props = $props();

	const eyedropperActive = $derived(activeTool === 'eyedropper');
	const revealCount = $derived(Object.values(reveals).filter((phase) => phase !== 'idle').length);
	let reviewOpen = $state(false);
	let matching = $state(false);
	const matchTarget = $derived(
		workspace.selectedPhoto?.frames.some(({ display }) => display !== null)
			? 'camera JPEG'
			: 'embedded preview'
	);
	const matchLabel = $derived.by(() => {
		if (workspace.cameraMatch.status === 'applied') {
			return `matched to ${workspace.cameraMatch.target === 'camera-jpeg' ? 'camera JPEG' : 'embedded preview'} · see what changed`;
		}
		if (workspace.cameraMatch.status === 'pending' || matching)
			return `matching to ${matchTarget}…`;
		return `match to ${matchTarget}`;
	});

	async function openCameraMatch() {
		if (workspace.cameraMatch.status === 'applied') {
			reviewOpen = true;
			return;
		}
		matching = true;
		try {
			await workspace.matchCamera();
		} finally {
			matching = false;
		}
	}
</script>

<Panel title="Color" bind:open {revealCount}>
	<div class="mb-3 flex gap-1">
		<button
			type="button"
			aria-label="Auto white balance"
			disabled={!workspace.canAdjustLight}
			onclick={() => void workspace.autoWhiteBalance()}
			class="h-6 flex-1 cursor-pointer rounded border border-subtle text-[11px] text-muted lowercase transition-colors hover:text-text disabled:cursor-default disabled:opacity-40"
		>
			auto
		</button>
		<button
			type="button"
			aria-label="White balance eyedropper"
			aria-pressed={eyedropperActive}
			disabled={!workspace.canAdjustLight}
			onclick={() => onPickTool('eyedropper')}
			class="flex h-6 flex-1 cursor-pointer items-center justify-center rounded border transition-colors disabled:cursor-default disabled:opacity-40 {eyedropperActive
				? 'border-control-edge bg-surface text-text'
				: 'border-subtle text-muted hover:text-text'}"
		>
			<Pipette size={12} strokeWidth={1.6} />
		</button>
	</div>
	<AdjustmentSliders
		sliders={COLOR_SLIDERS}
		values={workspace.adjustments}
		disabled={!workspace.canAdjustLight}
		{reveals}
		{onRevealInteraction}
		onPreview={(control, value) => workspace.previewAdjustment('color', control, value)}
		onCommit={(control, value) => workspace.commitAdjustment('color', control, value)}
	/>
	{#if workspace.hasCameraLook}
		<div class="mt-3 border-t border-subtle pt-3">
			<button
				type="button"
				disabled={!workspace.canAdjustLight ||
					workspace.cameraMatch.status === 'pending' ||
					matching}
				onclick={() => void openCameraMatch()}
				class="w-full cursor-pointer text-left text-[11px] text-muted hover:text-text disabled:cursor-default disabled:opacity-50"
			>
				{matchLabel}
			</button>
			<label class="mt-2 flex items-center justify-between gap-3 text-[10px] text-muted">
				<span>new RAWs</span>
				<select
					aria-label="Automatic camera matching"
					value={workspace.cameraMatchPreference}
					onchange={(event) =>
						workspace.setCameraMatchPreference(event.currentTarget.value as CameraMatchPreference)}
					class="min-w-0 cursor-pointer rounded border border-subtle bg-bg px-1.5 py-1 text-[10px] text-text outline-none focus:border-control-edge"
				>
					<option value="ask">ask first</option>
					<option value="always">match automatically</option>
					<option value="never">start neutral</option>
				</select>
			</label>
		</div>
	{/if}
	<button
		type="button"
		aria-label="open color mixer"
		onclick={onOpenMixer}
		class="mt-2 flex w-full cursor-pointer items-center justify-between rounded border border-subtle px-2 py-2 text-[11px] text-muted hover:text-text"
	>
		color mixer <SlidersHorizontal size={12} />
	</button>
</Panel>

<CameraMatchDialog bind:open={reviewOpen} {workspace} />

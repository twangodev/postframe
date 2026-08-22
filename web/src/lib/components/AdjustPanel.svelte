<script lang="ts">
	import { Tabs } from 'bits-ui';
	import { History } from '@lucide/svelte';
	import CameraMatchOnboarding from './CameraMatchOnboarding.svelte';
	import ColorMixerSection from './ColorMixerSection.svelte';
	import ColorSection from './ColorSection.svelte';
	import DetailSection from './DetailSection.svelte';
	import EffectsSection from './EffectsSection.svelte';
	import GradingSection from './GradingSection.svelte';
	import LightSection from './LightSection.svelte';
	import PresetsSection from './PresetsSection.svelte';
	import SnapshotsSection from './SnapshotsSection.svelte';
	import ToneCurveSection from './ToneCurveSection.svelte';
	import ImageScope from './ui/ImageScope.svelte';
	import Panel from './ui/Panel.svelte';
	import type { ControlRevealPhase } from '$lib/adjustment-reveal';
	import type { ColorControlName, LightControlName } from '$lib/develop-settings';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
		activeTool: string;
		onPickTool: (tool: string) => void;
	}

	let { workspace, activeTool, onPickTool }: Props = $props();

	let mixerOpen = $state(false);
	let lightOpen = $state(true);
	let curveOpen = $state(false);
	let colorOpen = $state(true);
	const candidate = $derived(workspace.cameraMatchCandidate);
	const lightReveals = $derived(
		revealControls(candidate?.changes.light ?? [], candidate?.phase ?? 'idle')
	);
	const colorReveals = $derived(
		revealControls(candidate?.changes.color ?? [], candidate?.phase ?? 'idle')
	);

	$effect(() => {
		if (!candidate) return;
		if (candidate.affected.light.length > 0) lightOpen = true;
		if (candidate.affected.curve.length > 0) curveOpen = true;
		if (candidate.affected.color.length > 0) colorOpen = true;
	});

	function revealControls<Control extends LightControlName | ColorControlName>(
		controls: readonly Control[],
		phase: ControlRevealPhase
	): Partial<Record<Control, ControlRevealPhase>> {
		if (phase === 'idle') return {};
		return Object.fromEntries(controls.map((control) => [control, phase])) as Partial<
			Record<Control, ControlRevealPhase>
		>;
	}
</script>

<Tabs.Content value="adjust" class="motion-tab">
	<CameraMatchOnboarding {workspace} />
	{#if candidate}
		{#if candidate.affected.light.length > 0}
			<LightSection
				{workspace}
				bind:open={lightOpen}
				reveals={lightReveals}
				disabled={candidate.view !== 'match'}
				focused
				onRevealInteraction={workspace.interruptCameraMatchReveal}
			/>
		{/if}
		{#if candidate.affected.curve.length > 0}
			<ToneCurveSection
				binding={workspace.globalDevelop}
				scope={workspace.imageScope}
				bind:open={curveOpen}
				revealedChannels={candidate.phase === 'idle' ? [] : candidate.changes.curve}
				revealPhase={candidate.phase}
				disabled={candidate.view !== 'match'}
				onRevealInteraction={workspace.interruptCameraMatchReveal}
			/>
		{/if}
		{#if candidate.affected.color.length > 0}
			<ColorSection
				{workspace}
				{activeTool}
				{onPickTool}
				bind:open={colorOpen}
				reveals={colorReveals}
				disabled={candidate.view !== 'match'}
				focused
				onRevealInteraction={workspace.interruptCameraMatchReveal}
			/>
		{/if}
		{#if candidate.affected.light.length === 0 && candidate.affected.curve.length === 0 && candidate.affected.color.length === 0}
			<p class="border-b border-subtle p-3 text-[10px] leading-relaxed text-muted">
				The editable controls already match this rendering.
			</p>
		{/if}
	{:else}
		<div class="border-b border-subtle p-3">
			<ImageScope
				data={workspace.imageScope}
				loading={workspace.activeDocument?.kind === 'loading'}
				clipping={workspace.clipping}
				onToggleClipping={workspace.toggleClipping}
			/>
		</div>

		<Panel title="Profile" meta="Camera look">
			<button
				type="button"
				class="flex h-8 w-full cursor-pointer items-center justify-between rounded border border-subtle bg-surface px-2 text-[12px] text-text/80 hover:border-muted"
			>
				<span>camera standard</span><span class="font-mono text-[11px] text-muted">PF</span>
			</button>
		</Panel>

		<LightSection {workspace} bind:open={lightOpen} />
		<ToneCurveSection
			binding={workspace.globalDevelop}
			scope={workspace.imageScope}
			bind:open={curveOpen}
		/>
		<ColorSection
			{workspace}
			{activeTool}
			{onPickTool}
			onOpenMixer={() => (mixerOpen = true)}
			bind:open={colorOpen}
		/>
		<ColorMixerSection binding={workspace.globalDevelop} bind:open={mixerOpen} />
		<GradingSection binding={workspace.globalDevelop} />
		<DetailSection {workspace} />
		<EffectsSection {workspace} />

		<Panel title="Optics" open={false}>
			<label class="flex cursor-pointer items-center gap-2 py-1 text-[11px] text-muted">
				<input type="checkbox" checked class="accent-accent" /> remove chromatic aberration
			</label>
			<label class="flex cursor-pointer items-center gap-2 py-1 text-[11px] text-muted">
				<input type="checkbox" checked class="accent-accent" /> use lens profile
			</label>
		</Panel>

		<SnapshotsSection {workspace} />
		<PresetsSection {workspace} />

		<Panel title="History" open={false} meta={`${workspace.history.length}`}>
			<div class="space-y-2 border-l border-subtle pl-3">
				{#each [...workspace.history].reverse() as item, index (index)}
					<div
						class="flex items-center gap-2 text-[11px] lowercase {index === 0
							? 'text-text'
							: 'text-muted'}"
					>
						<History size={10} />
						{item}
					</div>
				{/each}
			</div>
		</Panel>
	{/if}
</Tabs.Content>

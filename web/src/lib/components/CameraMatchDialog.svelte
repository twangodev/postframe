<script lang="ts">
	import DialogFooter from './ui/DialogFooter.svelte';
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';
	import { destructiveButtonClass, primaryButtonClass } from '$lib/button';
	import type { CameraMatchResult } from '$lib/camera-match';
	import type { CameraMatch } from '$lib/edit-document';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		open?: boolean;
		workspace: WorkspaceState;
	}

	let { open = $bindable(false), workspace }: Props = $props();

	type MatchGroup = 'light' | 'color' | 'curve';

	let selected = $derived<MatchGroup[]>(open ? ['light', 'color', 'curve'] : []);
	const match = $derived<Extract<CameraMatch, { status: 'applied' }> | null>(
		workspace.cameraMatch.status === 'applied' ? workspace.cameraMatch : null
	);

	function toggle(group: MatchGroup, checked: boolean) {
		selected = checked
			? [...selected.filter((candidate) => candidate !== group), group]
			: selected.filter((candidate) => candidate !== group);
	}

	function confirm(event: SubmitEvent) {
		event.preventDefault();
		workspace.reviewCameraMatch(selected);
		open = false;
	}

	function discard() {
		workspace.discardCameraMatch();
		open = false;
	}

	const signed = (value: number, digits = 0) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
	const shaped = (points: readonly { x: number; y: number }[]) =>
		points.length > 2 || points.some(({ x, y }) => Math.abs(x - y) > 0.001);
	const curveSummary = (curve: CameraMatchResult['curve']) =>
		(
			[
				['red', curve.red],
				['green', curve.green],
				['blue', curve.blue]
			] as const
		)
			.filter(([, points]) => shaped(points))
			.map(([name]) => `${name} shaped`)
			.join(' · ') || 'neutral';
</script>

<DialogShell bind:open size="sm" class="p-5">
	<form onsubmit={confirm}>
		<DialogHeader
			title="camera match"
			description={match?.target === 'embedded-preview'
				? 'ordinary settings derived from the camera’s embedded preview.'
				: 'ordinary settings derived from the camera JPEG.'}
		/>

		{#if match}
			<div class="mt-5 space-y-2">
				<label class="flex cursor-pointer items-start gap-3 rounded border border-subtle p-3">
					<input
						type="checkbox"
						checked={selected.includes('light')}
						onchange={(event) => toggle('light', event.currentTarget.checked)}
						class="mt-0.5 accent-accent"
					/>
					<span class="min-w-0">
						<span class="block text-xs text-text">light</span>
						<span class="font-mono text-[10px] text-muted">
							exposure {signed(match.result.light.exposure, 2)} EV · contrast
							{signed(match.result.light.contrast)}
						</span>
					</span>
				</label>
				<label class="flex cursor-pointer items-start gap-3 rounded border border-subtle p-3">
					<input
						type="checkbox"
						checked={selected.includes('color')}
						onchange={(event) => toggle('color', event.currentTarget.checked)}
						class="mt-0.5 accent-accent"
					/>
					<span class="min-w-0">
						<span class="block text-xs text-text">color</span>
						<span class="font-mono text-[10px] text-muted">
							temperature {signed(match.result.color.temperature)} · tint
							{signed(match.result.color.tint)}
						</span>
					</span>
				</label>
				<label class="flex cursor-pointer items-start gap-3 rounded border border-subtle p-3">
					<input
						type="checkbox"
						checked={selected.includes('curve')}
						onchange={(event) => toggle('curve', event.currentTarget.checked)}
						class="mt-0.5 accent-accent"
					/>
					<span class="min-w-0">
						<span class="block text-xs text-text">curves</span>
						<span class="text-[10px] text-muted">
							{curveSummary(match.result.curve)}
						</span>
					</span>
				</label>
			</div>

			<p class="mt-4 text-[11px] leading-relaxed text-muted">
				These settings and their fitted camera transform reproduce the camera rendering to within
				<span class="font-mono text-text">{match.result.meanError.toFixed(2)}/255</span> on average.
			</p>
		{/if}

		<DialogFooter cancel class="mt-5">
			<button type="button" onclick={discard} class={destructiveButtonClass}>start neutral</button>
			<button type="submit" class={primaryButtonClass}>apply choices</button>
		</DialogFooter>
	</form>
</DialogShell>

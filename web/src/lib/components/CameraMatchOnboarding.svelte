<script lang="ts">
	import { primaryButtonClass, secondaryButtonClass } from '$lib/button';
	import { cameraMatchReviewSummary } from '$lib/camera-match';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	interface Props {
		workspace: WorkspaceState;
	}

	let { workspace }: Props = $props();

	const candidate = $derived(workspace.cameraMatchCandidate);
	const target = $derived(
		candidate?.target === 'camera-jpeg' ? 'camera JPEG' : 'embedded camera preview'
	);
	const baselineLabel = $derived(candidate?.firstRun ? 'neutral RAW' : 'current edit');
	const moving = $derived(candidate?.phase === 'targeting' || candidate?.phase === 'moving');
	const reviewSummary = $derived(candidate ? cameraMatchReviewSummary(candidate.affected) : '');
	let remember = $state(true);
	let candidateId = $state(0);

	$effect(() => {
		if (!candidate || candidate.id === candidateId) return;
		candidateId = candidate.id;
		remember = true;
	});

	function apply(event: SubmitEvent) {
		event.preventDefault();
		workspace.applyCameraMatchCandidate(remember);
	}
</script>

{#if candidate}
	<form
		onsubmit={apply}
		aria-labelledby="camera-match-title"
		class="sticky top-0 z-10 border-b border-accent bg-surface/95 p-3 backdrop-blur"
	>
		<h2 id="camera-match-title" class="text-xs font-medium text-text">match the {target}?</h2>
		<p class="mt-1 text-[9px] text-muted">{reviewSummary}</p>

		<div class="mt-2.5 grid grid-cols-2 rounded border border-subtle p-0.5">
			<button
				type="button"
				aria-pressed={candidate.view === 'baseline'}
				onclick={workspace.showCameraMatchBaseline}
				class="cursor-pointer rounded px-2 py-1.5 text-[10px] transition-colors {candidate.view ===
				'baseline'
					? 'bg-elevated text-text'
					: 'text-muted hover:text-text'}"
			>
				{baselineLabel}
			</button>
			<button
				type="button"
				aria-pressed={candidate.view === 'match'}
				onclick={workspace.revealCameraMatch}
				class="cursor-pointer rounded px-2 py-1.5 text-[10px] transition-colors {candidate.view ===
				'match'
					? 'bg-elevated text-text'
					: 'text-muted hover:text-text'}"
			>
				camera match
			</button>
		</div>

		{#if candidate.firstRun}
			<label class="mt-2.5 flex cursor-pointer items-center gap-2 text-[9px] text-muted">
				<input type="checkbox" bind:checked={remember} class="accent-accent" />
				remember this choice for new RAWs
			</label>
		{/if}

		<div class="mt-2.5 flex gap-2">
			<button
				type="button"
				onclick={() => workspace.dismissCameraMatchCandidate(remember)}
				class={secondaryButtonClass}
			>
				{candidate.firstRun ? 'start neutral' : 'keep current edit'}
			</button>
			<button
				type="submit"
				disabled={candidate.view !== 'match' || moving}
				class="{primaryButtonClass} disabled:cursor-default disabled:opacity-40"
			>
				use camera match
			</button>
		</div>
	</form>
{/if}

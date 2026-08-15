<script lang="ts">
	import { Check, X } from '@lucide/svelte';
	import { detectedSubjectName, type DetectedSubject } from '$lib/subject-detection';
	import { coverCrop } from '$lib/subject-picker-crop';
	import type { NormalizedRegion } from '$lib/edit-document';

	interface Props {
		subjects: DetectedSubject[];
		created: number[];
		previewSrc: string;
		busy: boolean;
		onChoose: (index: number) => void;
		onChooseAll: () => void;
		onDismiss: () => void;
		onHover: (box: NormalizedRegion | null) => void;
	}

	let { subjects, created, previewSrc, busy, onChoose, onChooseAll, onDismiss, onHover }: Props =
		$props();

	const CHIP_ASPECT = 44 / 56;

	let naturalWidth = $state(0);
	let naturalHeight = $state(0);
	const imageAspect = $derived(
		naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 1
	);

	function cropStyle(box: NormalizedRegion) {
		const crop = coverCrop(box, CHIP_ASPECT, imageAspect);
		return (
			`background-image: url(${previewSrc});` +
			`background-size: ${crop.size};` +
			`background-position: ${crop.position};`
		);
	}
</script>

<div class="border-subtle border-b p-3">
	<img class="hidden" src={previewSrc} alt="" bind:naturalWidth bind:naturalHeight />
	<div class="mb-2 flex items-center justify-between">
		<p class="text-muted text-[11px] tracking-[0.03em]">
			{subjects.length} subjects found · choose one to mask
		</p>
		<button
			type="button"
			aria-label="Dismiss subject choices"
			class="text-muted hover:text-text cursor-pointer rounded p-0.5 transition-colors"
			onclick={onDismiss}
		>
			<X size={12} />
		</button>
	</div>
	<div class="flex flex-wrap gap-1.5">
		{#each subjects as subject, index (index)}
			<button
				type="button"
				class="subject-choice"
				disabled={busy || created.includes(index)}
				onclick={() => onChoose(index)}
				onpointerenter={() => onHover(subject.box)}
				onpointerleave={() => onHover(null)}
				onfocus={() => onHover(subject.box)}
				onblur={() => onHover(null)}
			>
				<span
					class="bg-surface relative block h-14 w-11 overflow-hidden rounded"
					style={cropStyle(subject.box)}
				>
					{#if created.includes(index)}
						<span class="absolute inset-0 flex items-center justify-center bg-black/55 text-white">
							<Check size={14} />
						</span>
					{/if}
				</span>
				<span class="text-muted block truncate text-center text-[10px] lowercase">
					{detectedSubjectName(subjects, index)}
				</span>
			</button>
		{/each}
		<button
			type="button"
			class="subject-choice"
			disabled={busy}
			onclick={onChooseAll}
			onpointerenter={() => onHover(null)}
		>
			<span
				class="bg-surface block h-14 w-11 overflow-hidden rounded bg-cover bg-center"
				style={`background-image: url(${previewSrc});`}
			></span>
			<span class="text-muted block truncate text-center text-[10px] lowercase">everyone</span>
		</button>
	</div>
</div>

<style>
	.subject-choice {
		display: flex;
		width: 2.75rem;
		cursor: pointer;
		flex-direction: column;
		gap: 0.25rem;
		border-radius: 0.25rem;
	}
	.subject-choice:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.subject-choice:not(:disabled):hover > span:first-child {
		outline: 1px solid var(--color-accent);
		outline-offset: 1px;
	}
</style>

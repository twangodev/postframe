<script lang="ts">
	import { Slider } from 'bits-ui';
	import { onDestroy } from 'svelte';
	import { formatAdjustment } from '$lib/adjustment-format';
	import type { ControlRevealPhase } from '$lib/adjustment-reveal';

	interface Props {
		label: string;
		value?: number;
		min: number;
		max: number;
		step?: number;
		defaultValue?: number;
		suffix?: string;
		decimals?: number;
		signed?: boolean;
		disabled?: boolean;
		revealPhase?: ControlRevealPhase;
		onRevealInteraction?: () => void;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
	}

	let {
		label,
		value = $bindable(0),
		min,
		max,
		step = 1,
		defaultValue = 0,
		suffix = '',
		decimals = 0,
		signed = true,
		disabled = false,
		revealPhase = 'idle',
		onRevealInteraction = () => {},
		onValueChange = () => {},
		onValueCommit = () => {}
	}: Props = $props();

	let editing = $state(false);
	let draft = $state('');
	let wheelCommitTimer: ReturnType<typeof setTimeout> | undefined;
	let wheelCommitPending = false;

	const format = (candidate: number) => formatAdjustment(candidate, { signed, decimals, suffix });
	const formatted = $derived(format(value));
	const inputValue = $derived(editing ? draft : formatted);
	const revealing = $derived(revealPhase === 'targeting' || revealPhase === 'moving');
	const revealed = $derived(revealPhase !== 'idle');

	function normalize(candidate: number) {
		const bounded = Math.min(max, Math.max(min, candidate));
		const snapped = min + Math.round((bounded - min) / step) * step;
		const precision = Math.max(decimals, fractionDigits(step));
		return Number(snapped.toFixed(precision));
	}

	function fractionDigits(candidate: number) {
		const [, fraction = ''] = candidate.toString().split('.');
		return fraction.length;
	}

	function updateValue(candidate: number) {
		const next = normalize(candidate);
		if (next === value) return null;
		value = next;
		onValueChange(next);
		return next;
	}

	function apply(candidate: number) {
		flushWheelCommit();
		const next = updateValue(candidate);
		if (next === null) return;
		onValueCommit(next);
	}

	function scheduleWheelCommit() {
		if (wheelCommitTimer !== undefined) clearTimeout(wheelCommitTimer);
		wheelCommitPending = true;
		wheelCommitTimer = setTimeout(flushWheelCommit, 180);
	}

	function flushWheelCommit() {
		if (wheelCommitTimer !== undefined) clearTimeout(wheelCommitTimer);
		wheelCommitTimer = undefined;
		if (!wheelCommitPending) return;
		wheelCommitPending = false;
		onValueCommit(value);
	}

	function handleWheel(event: WheelEvent) {
		if (disabled || event.deltaY === 0 || event.ctrlKey || event.metaKey) return;
		interruptReveal();
		event.preventDefault();
		const next = updateValue(value + (event.deltaY < 0 ? step : -step));
		if (next === null) return;
		editing = false;
		draft = '';
		scheduleWheelCommit();
	}

	function reset(event: MouseEvent) {
		if (disabled) return;
		event.preventDefault();
		event.stopPropagation();
		apply(defaultValue);
	}

	function beginEditing(event: FocusEvent & { currentTarget: HTMLInputElement }) {
		interruptReveal();
		flushWheelCommit();
		editing = true;
		draft = value.toFixed(decimals);
		const input = event.currentTarget;
		queueMicrotask(() => input.select());
	}

	function updateDraft(event: Event & { currentTarget: HTMLInputElement }) {
		draft = event.currentTarget.value;
	}

	function commitDraft() {
		if (!editing) return;
		const candidate = draft.trim() === '' ? Number.NaN : Number(draft);
		editing = false;
		if (Number.isFinite(candidate)) apply(candidate);
	}

	function cancelDraft() {
		editing = false;
	}

	function handleKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		interruptReveal();
		if (event.key === 'Enter') {
			event.preventDefault();
			commitDraft();
			event.currentTarget.blur();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelDraft();
			event.currentTarget.blur();
		}
	}

	function interruptReveal() {
		if (revealing) onRevealInteraction();
	}

	onDestroy(flushWheelCommit);
</script>

<div
	class="grid grid-cols-[4.75rem_1fr_3.5rem] items-center gap-2 py-1 transition-opacity"
	class:opacity-40={disabled}
>
	<span class="truncate text-[11px] text-text/75 lowercase">{label}</span>
	<Slider.Root
		type="single"
		bind:value
		{min}
		{max}
		{step}
		{disabled}
		{onValueChange}
		{onValueCommit}
		onpointerdown={interruptReveal}
		onfocusin={interruptReveal}
		onkeydown={interruptReveal}
		ondblclick={reset}
		title={`double-click to reset ${label.toLowerCase()} to ${format(normalize(defaultValue))}`}
		class="relative flex h-4 w-full touch-none items-center"
	>
		{#snippet children({ thumbItems })}
			<span class="absolute inset-x-0 h-px bg-control-track"></span>
			<Slider.Range class="absolute h-px bg-control-active" />
			{#each thumbItems as thumb (thumb.index)}
				<Slider.Thumb
					index={thumb.index}
					aria-label={label}
					class="relative block size-2.5 rounded-full border bg-surface transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-accent {revealed
						? 'border-accent'
						: 'border-control-active'}"
				>
					{#if revealed}
						<span
							aria-hidden="true"
							data-phase={revealPhase}
							class="adjustment-reveal-halo pointer-events-none absolute inset-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent"
						></span>
					{/if}
				</Slider.Thumb>
			{/each}
		{/snippet}
	</Slider.Root>
	<input
		type="text"
		inputmode="decimal"
		aria-label={`${label} value`}
		value={inputValue}
		{disabled}
		spellcheck="false"
		title={`scroll to adjust ${label.toLowerCase()}`}
		onfocus={beginEditing}
		oninput={updateDraft}
		onblur={commitDraft}
		onkeydown={handleKeydown}
		onwheel={handleWheel}
		class="h-5 w-full rounded border border-transparent bg-transparent px-1 text-right font-mono text-[11px] text-muted tabular-nums transition-colors outline-none hover:border-control-track focus:border-control-edge focus:bg-surface disabled:cursor-default"
	/>
</div>

<style>
	.adjustment-reveal-halo[data-phase='targeting'] {
		animation: target-control 250ms var(--ease-out) both;
	}

	.adjustment-reveal-halo[data-phase='moving'] {
		opacity: 0.65;
		transform: translate(-50%, -50%) scale(0.72);
	}

	.adjustment-reveal-halo[data-phase='settled'] {
		opacity: 0.32;
		transform: translate(-50%, -50%) scale(0.62);
	}

	@keyframes target-control {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(1.9);
		}
		to {
			opacity: 0.85;
			transform: translate(-50%, -50%) scale(0.78);
		}
	}
</style>

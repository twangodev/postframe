<script lang="ts">
	import { Slider } from 'bits-ui';

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
		onValueChange = () => {},
		onValueCommit = () => {}
	}: Props = $props();

	let editing = $state(false);
	let draft = $state('');

	const format = (candidate: number) =>
		`${signed && candidate > 0 ? '+' : ''}${candidate.toFixed(decimals)}${suffix}`;
	const formatted = $derived(format(value));
	const inputValue = $derived(editing ? draft : formatted);

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

	function apply(candidate: number) {
		const next = normalize(candidate);
		if (next === value) return;
		value = next;
		onValueChange(next);
		onValueCommit(next);
	}

	function reset(event: MouseEvent) {
		if (disabled) return;
		event.preventDefault();
		event.stopPropagation();
		apply(defaultValue);
	}

	function beginEditing(event: FocusEvent & { currentTarget: HTMLInputElement }) {
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
</script>

<div
	class="grid grid-cols-[4.75rem_1fr_3.5rem] items-center gap-2 py-1 transition-opacity"
	class:opacity-40={disabled}
>
	<span class="text-text/75 truncate text-[10px] lowercase">{label}</span>
	<Slider.Root
		type="single"
		bind:value
		{min}
		{max}
		{step}
		{disabled}
		{onValueChange}
		{onValueCommit}
		ondblclick={reset}
		title={`double-click to reset ${label.toLowerCase()} to ${format(normalize(defaultValue))}`}
		class="relative flex h-4 w-full touch-none items-center"
	>
		{#snippet children({ thumbItems })}
			<span class="bg-muted/35 absolute inset-x-0 h-px"></span>
			<Slider.Range class="bg-text/70 absolute h-px" />
			{#each thumbItems as thumb (thumb.index)}
				<Slider.Thumb
					index={thumb.index}
					aria-label={label}
					class="border-text/70 bg-surface focus-visible:outline-accent block size-2.5 rounded-full border shadow-sm transition-transform hover:scale-125 focus-visible:outline-2"
				/>
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
		onfocus={beginEditing}
		oninput={updateDraft}
		onblur={commitDraft}
		onkeydown={handleKeydown}
		class="border-subtle/0 hover:border-subtle focus:border-muted focus:bg-surface text-muted h-5 w-full rounded border bg-transparent px-1 text-right font-mono text-[10px] tabular-nums transition-colors outline-none disabled:cursor-default"
	/>
</div>

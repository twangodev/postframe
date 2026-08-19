<script lang="ts">
	import DialogFooter from './ui/DialogFooter.svelte';
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';
	import { primaryButtonClass } from '$lib/button';
	import { DEVELOP_GROUP_NAMES, type DevelopGroupName } from '$lib/develop-settings';
	import { DEVELOP_GROUP_LABELS } from '$lib/preset';

	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		confirmLabel: string | ((name: string) => string);
		groups: readonly DevelopGroupName[];
		name?: { value: string; label: string };
		onConfirm: (groups: DevelopGroupName[], name?: string) => void;
	}

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel,
		groups,
		name,
		onConfirm
	}: Props = $props();

	let selected = $derived<DevelopGroupName[]>(open ? [...groups] : []);
	let presetName = $derived(open ? (name?.value ?? '') : '');

	const label = $derived(
		typeof confirmLabel === 'function' ? confirmLabel(presetName.trim()) : confirmLabel
	);
	const canConfirm = $derived(selected.length > 0 && (!name || presetName.trim().length > 0));

	function toggle(group: DevelopGroupName, checked: boolean) {
		selected = DEVELOP_GROUP_NAMES.filter((candidate) =>
			candidate === group ? checked : selected.includes(candidate)
		);
	}

	function confirm(event: SubmitEvent) {
		event.preventDefault();
		if (!canConfirm) return;
		onConfirm([...selected], name ? presetName.trim() : undefined);
		open = false;
	}
</script>

<DialogShell bind:open size="sm" class="p-5">
	<form onsubmit={confirm}>
		<DialogHeader {title} {description} />

		{#if name}
			<input
				bind:value={presetName}
				aria-label={name.label}
				placeholder={name.label}
				class="mt-5 w-full rounded border border-subtle bg-surface px-3 py-2 text-xs placeholder:text-muted/50 focus:border-accent focus:outline-none"
			/>
		{/if}

		<div class="mt-5 flex items-center justify-between text-[11px] tracking-[0.04em] text-muted">
			<span>settings</span>
			<span class="flex gap-2">
				<button
					type="button"
					class="cursor-pointer hover:text-text"
					onclick={() => (selected = [...DEVELOP_GROUP_NAMES])}
				>
					all
				</button>
				<span aria-hidden="true">/</span>
				<button
					type="button"
					class="cursor-pointer hover:text-text"
					onclick={() => (selected = [])}
				>
					none
				</button>
			</span>
		</div>
		<div class="mt-2 grid grid-cols-2 gap-x-4">
			{#each DEVELOP_GROUP_NAMES as group (group)}
				<label class="flex cursor-pointer items-center gap-2 py-1 text-[11px] text-text/85">
					<input
						type="checkbox"
						checked={selected.includes(group)}
						onchange={(event) => toggle(group, event.currentTarget.checked)}
						class="accent-accent"
					/>
					{DEVELOP_GROUP_LABELS[group]}
				</label>
			{/each}
		</div>

		<DialogFooter cancel class="mt-4">
			<button type="submit" disabled={!canConfirm} class={primaryButtonClass}>
				{label}
			</button>
		</DialogFooter>
	</form>
</DialogShell>

<script lang="ts">
	import { Database, RefreshCw, ShieldCheck, Trash2 } from '@lucide/svelte';
	import type { BrowserStorageStatus } from '$lib/browser-storage';
	import type { CleanupResult } from '$lib/library-service';
	import type { StorageBreakdown } from '$lib/storage-breakdown';
	import { formatBytes } from '$lib/format-bytes';
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';
	import StorageBar from './StorageBar.svelte';

	type Action = 'refresh' | 'persist' | 'cleanup' | 'clear';
	type Callback = () => void | Promise<void>;

	interface Props {
		open?: boolean;
		status: BrowserStorageStatus | null;
		breakdown?: StorageBreakdown | null;
		error?: string | null;
		cleanupResult?: CleanupResult | null;
		onRefresh: Callback;
		onRequestPersistence: Callback;
		onCleanup: Callback;
		onClearLocalData: Callback;
	}

	let {
		open = $bindable(false),
		status,
		breakdown = null,
		error = null,
		cleanupResult = null,
		onRefresh,
		onRequestPersistence,
		onCleanup,
		onClearLocalData
	}: Props = $props();
	let action = $state<Action | null>(null);
	let actionError = $state<string | null>(null);
	let confirmingClear = $state(false);

	const busy = $derived(action !== null);

	async function run(nextAction: Action, callback: Callback) {
		if (busy) return;
		action = nextAction;
		actionError = null;

		try {
			await callback();
			if (nextAction === 'clear') {
				confirmingClear = false;
				open = false;
			}
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'storage action failed';
		} finally {
			action = null;
		}
	}

	function closeChanged(nextOpen: boolean) {
		if (!nextOpen && !busy) {
			confirmingClear = false;
			actionError = null;
		}
	}
</script>

<DialogShell bind:open onOpenChange={closeChanged} size="lg">
	<DialogHeader
		class="border-b border-subtle p-4"
		eyebrow={{ icon: Database, label: 'local storage' }}
		title="on this device"
		description="originals and edits stay in this browser."
		closeDisabled={busy}
	/>

	<div class="space-y-4 p-4">
		{#if status}
			{#if breakdown}
				<StorageBar {breakdown} />
			{/if}

			<div class="flex items-start gap-3">
				<ShieldCheck
					size={15}
					strokeWidth={1.35}
					class={status.persisted ? 'mt-0.5 text-positive' : 'mt-0.5 text-muted'}
				/>
				<div class="min-w-0 flex-1">
					<p class="text-xs">
						{status.persisted
							? 'kept on this device'
							: status.capabilities.persistence
								? 'browser-managed storage'
								: 'persistence unavailable'}
					</p>
					<p class="mt-0.5 text-[11px] leading-relaxed text-muted">
						{status.persisted
							? 'the browser granted protection from routine storage eviction.'
							: 'local data may be removed when the browser needs space.'}
					</p>
				</div>
			</div>
		{:else}
			<div class="flex h-24 items-center justify-center text-[11px] text-muted">
				storage details unavailable
			</div>
		{/if}

		{#if error || actionError}
			<p class="text-[11px] text-negative" role="status">{actionError ?? error}</p>
		{/if}
		{#if cleanupResult}
			<p class="text-[11px] text-muted" role="status">
				{cleanupResult.deletedFiles === 0
					? 'nothing to clean up.'
					: `removed ${cleanupResult.deletedFiles} files · ${formatBytes(cleanupResult.reclaimedBytes)}`}
				{#if cleanupResult.failedFiles > 0}
					· {cleanupResult.failedFiles} could not be removed
				{/if}
			</p>
		{/if}

		{#if confirmingClear}
			<div class="rounded border border-negative/40 bg-negative/5 p-3">
				<p class="text-xs">delete the local library?</p>
				<p class="mt-1 text-[11px] leading-relaxed text-muted">
					this removes originals and edits from this browser. it cannot be undone.
				</p>
				<div class="mt-3 flex justify-end gap-2">
					<button
						type="button"
						disabled={busy}
						class="cursor-pointer rounded border border-subtle px-3 py-2 text-[11px] text-muted transition-colors hover:bg-surface hover:text-text disabled:cursor-wait disabled:opacity-40"
						onclick={() => (confirmingClear = false)}
					>
						cancel
					</button>
					<button
						type="button"
						disabled={busy}
						class="cursor-pointer rounded bg-negative px-3 py-2 text-[11px] font-medium text-bg transition-opacity disabled:cursor-wait disabled:opacity-45"
						onclick={() => run('clear', onClearLocalData)}
					>
						{action === 'clear' ? 'clearing…' : 'clear everything'}
					</button>
				</div>
			</div>
		{/if}
	</div>

	{#if !confirmingClear}
		<div class="flex flex-wrap items-center justify-between gap-y-2 border-t border-subtle p-4">
			<button
				type="button"
				disabled={busy}
				aria-label="Refresh storage details"
				class="flex cursor-pointer items-center gap-1.5 rounded px-2 py-2 text-[11px] text-muted transition-colors hover:text-text disabled:cursor-wait disabled:opacity-40"
				onclick={() => run('refresh', onRefresh)}
			>
				<RefreshCw size={12} class={action === 'refresh' ? 'animate-spin' : ''} />
				refresh
			</button>
			<div class="flex gap-2">
				<button
					type="button"
					disabled={busy}
					class="flex cursor-pointer items-center gap-1.5 rounded border border-subtle px-3 py-2 text-[11px] text-muted transition-colors hover:bg-surface hover:text-text disabled:cursor-wait disabled:opacity-40"
					onclick={() => run('cleanup', onCleanup)}
				>
					<RefreshCw size={12} class={action === 'cleanup' ? 'animate-spin' : ''} />
					{action === 'cleanup' ? 'cleaning…' : 'clean up'}
				</button>
				<button
					type="button"
					disabled={busy}
					class="flex cursor-pointer items-center gap-1.5 rounded border border-subtle px-3 py-2 text-[11px] text-muted transition-colors hover:bg-surface hover:text-text disabled:cursor-wait disabled:opacity-40"
					onclick={() => (confirmingClear = true)}
				>
					<Trash2 size={12} /> clear
				</button>
				{#if status?.capabilities.persistence && !status.persisted}
					<button
						type="button"
						disabled={busy}
						class="flex cursor-pointer items-center gap-1.5 rounded bg-text px-3 py-2 text-[11px] font-medium text-bg transition-opacity disabled:cursor-wait disabled:opacity-45"
						onclick={() => run('persist', onRequestPersistence)}
					>
						<ShieldCheck size={12} />
						{action === 'persist' ? 'requesting…' : 'keep locally'}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</DialogShell>

<script lang="ts">
	import { FolderOpen, LibraryBig } from '@lucide/svelte';
	import postframeLogo from '$lib/assets/favicon.svg';
	import { buttonClass } from '$lib/button';
	import type { WorkspaceState } from '$lib/workspace.svelte';

	let { workspace }: { workspace: WorkspaceState } = $props();
	let busy = $state<'create' | 'open' | null>(null);
	let error = $state<string | null>(null);

	async function run(action: 'create' | 'open') {
		if (busy) return;
		busy = action;
		error = null;
		try {
			if (action === 'create') await workspace.createDesktopLibrary();
			else await workspace.openDesktopLibrary();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to open the desktop library';
		} finally {
			busy = null;
		}
	}
</script>

<main class="flex min-h-svh items-center justify-center bg-bg px-6 text-text">
	<section class="motion-enter w-full max-w-md">
		<div class="flex items-center gap-2">
			<img src={postframeLogo} alt="" class="size-7" />
			<span class="text-[14px] font-medium tracking-tight">postframe</span>
		</div>
		<p class="mt-3 text-[14px] text-muted">choose where this desktop keeps its library.</p>

		<div class="mt-8 rounded border border-subtle bg-surface/35 p-4">
			<div class="flex items-start gap-3">
				<LibraryBig size={17} strokeWidth={1.35} class="mt-0.5 text-accent" />
				<div>
					<p class="text-xs">managed library</p>
					<p class="mt-1 text-[11px] leading-relaxed text-muted">
						postframe copies originals, edits, thumbnails, and masks into one folder you choose.
					</p>
				</div>
			</div>
		</div>

		{#if error || workspace.libraryError}
			<p class="mt-3 text-[11px] leading-relaxed text-negative" role="status">
				{error ?? workspace.libraryError}
			</p>
		{/if}

		<div class="mt-5 flex gap-2">
			<button
				type="button"
				disabled={busy !== null}
				class="flex flex-1 items-center justify-center gap-1.5 {buttonClass('primary', {
					busy: true
				})}"
				onclick={() => run('create')}
			>
				<LibraryBig size={13} />
				{busy === 'create' ? 'creating…' : 'create library'}
			</button>
			<button
				type="button"
				disabled={busy !== null}
				class="flex flex-1 items-center justify-center gap-1.5 {buttonClass('secondary', {
					busy: true
				})}"
				onclick={() => run('open')}
			>
				<FolderOpen size={13} />
				{busy === 'open' ? 'opening…' : 'open library'}
			</button>
		</div>
	</section>
</main>

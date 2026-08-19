<script lang="ts">
	import { Images, Upload } from '@lucide/svelte';
	import DialogFooter from './ui/DialogFooter.svelte';
	import DialogHeader from './ui/DialogHeader.svelte';
	import DialogShell from './ui/DialogShell.svelte';
	import { primaryButtonClass } from '$lib/button';

	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		onCreate: (name: string, files: File[]) => Promise<void>;
		photos?: { accept: string; ready: boolean };
	}

	let { open = $bindable(false), onOpenChange, onCreate, photos }: Props = $props();

	let name = $state('');
	let files = $state<File[]>([]);
	let busy = $state(false);

	function chooseFiles(list: FileList | null) {
		if (list) files = [...list];
	}

	function dropFiles(event: DragEvent) {
		event.preventDefault();
		chooseFiles(event.dataTransfer?.files ?? null);
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim() || busy) return;
		busy = true;
		try {
			await onCreate(name, files);
			name = '';
			files = [];
		} finally {
			busy = false;
		}
	}
</script>

<DialogShell bind:open {onOpenChange} size={photos ? 'lg' : 'sm'} class="p-5">
	<form onsubmit={create}>
		<DialogHeader
			title={photos ? 'new collection' : 'create collection'}
			description={photos
				? 'group photographs without moving them.'
				: 'selected photos will be added automatically.'}
		/>
		<input
			bind:value={name}
			placeholder="collection name"
			class="mt-5 w-full rounded border border-subtle bg-surface px-3 py-2 text-xs placeholder:text-muted/50 focus:border-accent focus:outline-none"
		/>
		{#if photos}
			<label
				class="mt-4 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-muted/45 bg-surface/45 px-6 text-center transition-colors hover:border-accent/70 hover:bg-surface"
				ondragover={(event) => event.preventDefault()}
				ondrop={dropFiles}
			>
				<input
					type="file"
					multiple
					accept={photos.accept}
					disabled={!photos.ready}
					class="sr-only"
					onchange={(event) => chooseFiles(event.currentTarget.files)}
				/>
				{#if files.length > 0}
					<Images size={22} strokeWidth={1.25} class="mb-3 text-accent" />
					<p class="text-xs text-text">
						{files.length} photo{files.length === 1 ? '' : 's'} ready
					</p>
					<p class="mt-1 max-w-xs truncate font-mono text-[11px] text-muted">
						{files
							.slice(0, 3)
							.map((file) => file.name)
							.join(' · ')}
					</p>
				{:else}
					<Upload size={22} strokeWidth={1.25} class="mb-3 text-muted" />
					<p class="text-xs text-text">choose photos or drop them here</p>
					<p class="mt-1 text-[11px] text-muted">local files only</p>
				{/if}
			</label>
		{/if}
		<DialogFooter class="mt-4">
			<button type="submit" disabled={!name.trim() || busy} class={primaryButtonClass}>
				create collection
			</button>
		</DialogFooter>
	</form>
</DialogShell>

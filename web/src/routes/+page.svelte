<script lang="ts">
	import { onDestroy } from 'svelte';
	import { MonitorUp } from '@lucide/svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import EditWorkspace from '$lib/components/EditWorkspace.svelte';
	import ExportDialog from '$lib/components/ExportDialog.svelte';
	import OrganizeWorkspace from '$lib/components/OrganizeWorkspace.svelte';
	import Welcome from '$lib/components/Welcome.svelte';
	import { WorkspaceState } from '$lib/workspace.svelte';

	const workspace = new WorkspaceState();
	let exportOpen = $state(false);

	onDestroy(() => workspace.destroy());
</script>

<svelte:head>
	<title>postframe | photo workspace</title>
</svelte:head>

{#if workspace.mode === 'welcome'}
	<Welcome
		acceptedPhotos={workspace.acceptedPhotos}
		sourceReady={workspace.capabilitiesReady}
		ingestError={workspace.ingestError}
		onOpenPhoto={(file) => workspace.openSingle(file)}
		onCreateCollection={(name, files) => workspace.createCollection(name, files)}
	/>
{:else}
	<div class="bg-bg text-text hidden h-svh min-h-0 flex-col min-[900px]:flex">
		<AppHeader
			{workspace}
			onImport={(files) => workspace.importFiles(files)}
			onExport={() => (exportOpen = true)}
		/>
		{#key workspace.mode}
			<div class="motion-workspace flex min-h-0 flex-1 overflow-hidden">
				{#if workspace.mode === 'organize'}
					<OrganizeWorkspace {workspace} onImport={(files) => workspace.importFiles(files)} />
				{:else}
					<EditWorkspace {workspace} />
				{/if}
			</div>
		{/key}
	</div>

	<div
		class="bg-bg flex min-h-svh flex-col items-center justify-center px-8 text-center min-[900px]:hidden"
	>
		<MonitorUp size={30} strokeWidth={1} class="text-muted mb-5" />
		<p class="text-accent text-[10px] tracking-[0.04em]">desktop workspace</p>
		<h1 class="mt-3 text-xl font-medium tracking-tight">a little more room, please.</h1>
		<p class="text-muted mt-3 max-w-sm text-xs leading-relaxed">
			postframe's editing workspace is designed for displays at least 900 pixels wide. your files
			remain in this browser's local storage.
		</p>
		<button
			type="button"
			class="border-subtle text-muted hover:text-text mt-6 cursor-pointer rounded border px-4 py-2 text-[10px] tracking-wide"
			onclick={() => workspace.reset()}
		>
			back to start
		</button>
	</div>

	<ExportDialog bind:open={exportOpen} {workspace} />
{/if}

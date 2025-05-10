<script lang="ts">
	import Hero from '$lib/components/Hero.svelte';
	import UpdateProfile from '$lib/components/UpdateProfile.svelte';
	import { onMount } from 'svelte';
	import { PUBLIC_SUPABASE_URL } from '$env/static/public';

	export let data;
	let avatar: string;

	// Reactive statement to update avatar when data changes
	$: userProfile = data?.userProfile || '';
	$: avatar = data?.user?.user_metadata?.avatar_url || '';

	// Upload form state
	let textContent = '';
	let sourceType = 'manual';
	let sourceUrl = '';
	let userAiKey = '';
	let uploadStatus: 'idle' | 'loading' | 'success' | 'error' = 'idle';
	let uploadError = '';
	let uploadSuccessMsg = '';
	let uploadDebug: any = null;

	async function handleUpload(event: Event) {
		event.preventDefault();
		uploadStatus = 'loading';
		uploadError = '';
		uploadSuccessMsg = '';
		uploadDebug = null;
		try {
			const res = await fetch('/upload', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					text_content: textContent,
					source_type: sourceType,
					source_url: sourceUrl,
					user_ai_key: userAiKey
				})
			});
			const result = await res.json();
			if (!res.ok) {
				uploadStatus = 'error';
				uploadError = result?.error || 'Upload failed';
				uploadDebug = result?.debug;
				return;
			}
			uploadStatus = 'success';
			uploadSuccessMsg = 'Upload successful! Your data is being processed.';
			uploadDebug = result?.debug;
			textContent = '';
			sourceUrl = '';
			userAiKey = '';
		} catch (err: any) {
			uploadStatus = 'error';
			uploadError = err?.message || 'Unknown error';
		}
	}
</script>

{#if data?.userProfile}
	<UpdateProfile {userProfile} {avatar} />

	<!-- Upload Form -->
	<div class="mt-8 mx-auto max-w-xl bg-white rounded-lg shadow p-6">
		<h2 class="text-2xl font-semibold mb-2">Upload Text for AI Analysis</h2>
		<p class="mb-4 text-gray-500 text-sm">Paste text content below. Optionally provide a source type and URL. Your AI API key will only be used for this analysis and sent securely to the backend.</p>
		<form on:submit|preventDefault={handleUpload}>
			<div class="mb-4">
				<label class="block font-medium mb-1">Text Content</label>
				<textarea bind:value={textContent} required rows="6" class="w-full border rounded p-2"></textarea>
			</div>
			<div class="mb-4">
				<label class="block font-medium mb-1">Source Type</label>
				<input bind:value={sourceType} class="w-full border rounded p-2" placeholder="manual, article, interview, etc." />
			</div>
			<div class="mb-4">
				<label class="block font-medium mb-1">Source URL (optional)</label>
				<input bind:value={sourceUrl} class="w-full border rounded p-2" placeholder="https://..." />
			</div>
			<div class="mb-4">
				<label class="block font-medium mb-1">Your AI API Key</label>
				<input bind:value={userAiKey} type="password" class="w-full border rounded p-2" placeholder="OpenAI, OpenRouter, Gemini, etc." />
				<div class="text-xs text-gray-500 mt-1">
					This key is sent securely to the backend per request and never stored.
				</div>
			</div>
			<button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded" disabled={uploadStatus === 'loading'}>
				{uploadStatus === 'loading' ? 'Uploading...' : 'Upload'}
			</button>
		</form>
		{#if uploadStatus === 'error'}
			<div class="mt-3 text-red-600 font-semibold">{uploadError}</div>
			{#if uploadDebug}
				<pre class="bg-red-50 text-xs mt-2 p-2 rounded">{JSON.stringify(uploadDebug, null, 2)}</pre>
			{/if}
		{/if}
		{#if uploadStatus === 'success'}
			<div class="mt-3 text-green-600 font-semibold">{uploadSuccessMsg}</div>
			{#if uploadDebug}
				<pre class="bg-green-50 text-xs mt-2 p-2 rounded">{JSON.stringify(uploadDebug, null, 2)}</pre>
			{/if}
		{/if}
	</div>

	<!-- Insights Display -->
	<div class="mt-12 mx-auto max-w-xl bg-gray-50 rounded-lg shadow p-6">
		<h2 class="text-xl font-semibold mb-3">Your Uploaded Quotes / Insights</h2>
		{#if data.insightsError}
			<div class="text-red-600 font-semibold mb-3">{data.insightsError}</div>
			{#if data?.insights?.debug}
				<pre class="bg-red-50 text-xs mt-2 p-2 rounded">{JSON.stringify(data.insights.debug, null, 2)}</pre>
			{/if}
		{:else if data.insights && (data.insights.data ? data.insights.data.length > 0 : data.insights.length > 0)}
			<ul>
				{#each (data.insights.data || data.insights) as quote}
					<li class="mb-4 p-3 border-b">
						<div class="font-semibold">"{quote.text}"</div>
						{#if quote.raw_data?.sources?.metadata?.url}
							<div class="text-xs text-gray-500">Source: <a href={quote.raw_data.sources.metadata.url} target="_blank" class="underline text-blue-600">{quote.raw_data.sources.metadata.url}</a></div>
						{/if}
						{#if quote.sentiment}
							<div class="text-xs mt-1">Sentiment: {quote.sentiment}</div>
						{/if}
					</li>
				{/each}
			</ul>
			{#if data.insights?.debug}
				<pre class="bg-gray-100 text-xs mt-4 p-2 rounded">{JSON.stringify(data.insights.debug, null, 2)}</pre>
			{/if}
		{:else}
			<div class="text-gray-500">No insights found yet. Upload some text to get started.</div>
		{/if}
	</div>
{:else}
	<Hero />
{/if}
	</div>
{:else}
	<Hero />
{/if}

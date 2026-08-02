import { expect, test } from '@playwright/test';

test('persists, deduplicates, cleans, and clears a local photo library', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'open photo' })).toBeEnabled();
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 4;
		canvas.height = 4;
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#d8c3a5';
		context.fillRect(0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/png');
	});
	const pixel = {
		name: 'pixel.png',
		mimeType: 'image/png',
		buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
	};
	await page.locator('main input[type="file"]').first().setInputFiles(pixel);
	await expect(page.getByText('1 photo · saved locally')).toBeVisible();

	await page.reload();
	await expect(page.getByRole('button', { name: 'Select pixel.png' })).toBeVisible();
	await page.locator('header input[type="file"][multiple]').setInputFiles(pixel);
	await expect(page.getByText('1 photo · saved locally')).toBeVisible();

	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const app = await root.getDirectoryHandle('postframe', { create: true });
		const originals = await app.getDirectoryHandle('originals', { create: true });
		const handle = await originals.getFileHandle('orphan.png', { create: true });
		const writable = await handle.createWritable();
		await writable.write(new Blob(['orphan']));
		await writable.close();
	});
	await page.getByRole('button', { name: 'Manage local storage' }).click();
	await page.getByRole('button', { name: 'clean up' }).click();
	await expect(page.getByText(/removed 1 files/)).toBeVisible();

	await page.getByRole('button', { name: 'clear' }).click();
	await page.getByRole('button', { name: 'clear everything' }).click();
	await expect(page.getByRole('button', { name: 'open photo' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: 'open photo' })).toBeVisible();
});

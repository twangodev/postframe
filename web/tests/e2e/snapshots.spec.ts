import { expect, test, type Page } from '@playwright/test';

function storedSnapshotNames(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const app = await root.getDirectoryHandle('postframe');
		const edits = await app.getDirectoryHandle('edits');
		for await (const handle of edits.values()) {
			if (handle.kind !== 'file') continue;
			try {
				const document = JSON.parse(await (await handle.getFile()).text());
				return (document.snapshots ?? []).map(({ name }: { name: string }) => name);
			} catch {
				return null;
			}
		}
		return null;
	});
}

function midGreyJpeg(page: Page) {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 64;
		const context = canvas.getContext('2d')!;
		context.fillStyle = 'rgb(110, 110, 110)';
		context.fillRect(0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/jpeg', 0.95);
	});
}

test('a snapshot keeps a develop state that later edits can return to', async ({ page }) => {
	test.setTimeout(90_000);
	await page.goto('/?perf');
	const dataUrl = await midGreyJpeg(page);
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'grey.jpg',
			mimeType: 'image/jpeg',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	const exposure = page.getByRole('textbox', { name: 'Exposure value' });
	await expect(exposure).toBeEnabled({ timeout: 20_000 });

	await exposure.fill('1.5');
	await exposure.press('Enter');
	await expect(exposure).toHaveValue('+1.50 EV');

	await page.getByRole('button', { name: /^Snapshots/ }).click();
	await expect(page.getByText('no snapshots yet')).toBeVisible();
	await page.getByRole('button', { name: /save this state/ }).click();
	const nameField = page.getByRole('textbox', { name: 'Snapshot name' });
	await expect(nameField).toBeVisible();
	await nameField.fill('bright');
	await nameField.press('Enter');

	const savedSnapshot = page.getByRole('button', { name: 'bright', exact: true });
	await expect(savedSnapshot).toBeVisible();
	await expect.poll(() => storedSnapshotNames(page), { timeout: 15_000 }).toEqual(['bright']);

	await exposure.fill('-1');
	await exposure.press('Enter');
	await expect(exposure).toHaveValue('-1.00 EV');

	await savedSnapshot.click();
	await expect(exposure).toHaveValue('+1.50 EV');
	await page.getByRole('button', { name: 'History' }).click();
	await expect(page.getByText('applied bright snapshot', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Delete snapshot bright' }).click();
	await expect(page.getByText('no snapshots yet')).toBeVisible();
	await expect(exposure).toHaveValue('+1.50 EV');
	await expect.poll(() => storedSnapshotNames(page), { timeout: 15_000 }).toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';

const smartMasksEnabled = process.env.POSTFRAME_E2E_SMART_MASKS === '1';

function storedEdit(page: Page) {
	return page.evaluate(async () => {
		try {
			const root = await navigator.storage.getDirectory();
			const app = await root.getDirectoryHandle('postframe');
			const edits = await app.getDirectoryHandle('edits');
			for await (const handle of edits.values()) {
				if (handle.kind !== 'file') continue;
				return JSON.parse(await (await handle.getFile()).text());
			}
		} catch {
			return null;
		}
		return null;
	});
}

async function storedMasks(page: Page) {
	return (await storedEdit(page))?.masks ?? null;
}

test('layers object masks from separate paint sessions', async ({ page }) => {
	test.skip(
		!smartMasksEnabled,
		'SAM2 inference downloads models from huggingface.co; run with POSTFRAME_E2E_SMART_MASKS=1'
	);
	test.setTimeout(600_000);

	await page.goto('/');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 512;
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#f4efe4';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = '#22344d';
		context.fillRect(48, 176, 160, 160);
		context.fillStyle = '#b0402f';
		context.beginPath();
		context.arc(384, 256, 80, 0, Math.PI * 2);
		context.fill();
		return canvas.toDataURL('image/png');
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'objects.png',
			mimeType: 'image/png',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).toBeEnabled({
		timeout: 20_000
	});
	await page.getByRole('tab', { name: /^mask/ }).click();

	const viewport = page.getByRole('application', { name: 'Photo viewport' });
	const layers = page.getByRole('button', { name: 'Hide mask', exact: true });
	const aside = page.locator('aside');
	const rect = await viewport
		.getByRole('img', { name: 'objects.png', exact: true })
		.first()
		.boundingBox();
	if (!rect) throw new Error('photo is not visible in the viewport');
	const at = (fx: number, fy: number) => ({
		x: rect.x + fx * rect.width,
		y: rect.y + fy * rect.height
	});

	await aside.getByRole('button', { name: 'object', exact: true }).click();
	const squareFrom = at(0.2, 0.48);
	const squareTo = at(0.3, 0.53);
	await page.mouse.move(squareFrom.x, squareFrom.y);
	await page.mouse.down();
	await page.mouse.move(squareTo.x, squareTo.y, { steps: 6 });
	await page.mouse.up();
	await expect(layers).toHaveCount(1, { timeout: 480_000 });
	await expect
		.poll(() => storedMasks(page), { timeout: 60_000 })
		.toMatchObject([{ kind: 'object', components: [{ type: 'ai-object' }] }]);

	await aside.getByRole('button', { name: 'object', exact: true }).click();
	const circleFrom = at(0.72, 0.48);
	const circleTo = at(0.78, 0.52);
	await page.mouse.move(circleFrom.x, circleFrom.y);
	await page.mouse.down();
	await page.mouse.move(circleTo.x, circleTo.y, { steps: 6 });
	await page.mouse.up();
	await expect(layers).toHaveCount(2, { timeout: 240_000 });
	await expect
		.poll(() => storedMasks(page), { timeout: 60_000 })
		.toMatchObject([
			{ kind: 'object', components: [{ type: 'ai-object' }] },
			{ kind: 'object', components: [{ type: 'ai-object' }] }
		]);
});

import { expect, test } from '@playwright/test';

const incompressiblePng = (page: import('@playwright/test').Page, size: number, fill: string) =>
	page.evaluate(
		([size, fill]) => {
			const canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const context = canvas.getContext('2d')!;
			for (let y = 0; y < size; y += 1) {
				for (let x = 0; x < size; x += 1) {
					context.fillStyle = `hsl(${(x * 7 + y * 13) % 360} 60% ${40 + ((x * y) % 30)}%)`;
					context.fillRect(x, y, 1, 1);
				}
			}
			context.fillStyle = fill;
			context.fillRect(0, 0, 2, 2);
			return canvas.toDataURL('image/png');
		},
		[size, fill] as const
	);

const bytesShown = async (locator: import('@playwright/test').Locator) => {
	const text = await locator.textContent();
	const match = text?.match(/^([\d.]+) (B|KB|MB|GB|TB) on this device$/);
	if (!match) throw new Error(`no storage total in "${text}"`);
	const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[match[2]]!;
	return Number(match[1]) * scale;
};

test('the storage bar grows on its own when more is written', async ({ page }) => {
	await page.goto('/');
	const first = await incompressiblePng(page, 96, '#a03');
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'first.png',
			mimeType: 'image/png',
			buffer: Buffer.from(first.split(',')[1]!, 'base64')
		});
	await expect(page.getByText('1 photo · saved locally')).toBeVisible();

	await page.getByRole('button', { name: 'Manage local storage' }).click();
	const dialog = page.getByRole('dialog');
	const summary = dialog.getByText(/^[\d.]+ (B|KB|MB|GB|TB) on this device$/);
	await expect(summary).toBeVisible({ timeout: 15_000 });
	const before = await bytesShown(summary);
	expect(before).toBeGreaterThan(0);

	const largerImport = await incompressiblePng(page, 256, '#0a3');
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({
			name: 'second.png',
			mimeType: 'image/png',
			buffer: Buffer.from(largerImport.split(',')[1]!, 'base64')
		});

	await expect
		.poll(() => bytesShown(summary), { timeout: 15_000, message: 'storage total never updated' })
		.toBeGreaterThan(before);
});

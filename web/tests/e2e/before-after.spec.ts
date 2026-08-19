import { expect, test, type Page } from '@playwright/test';

function viewportCentrePixel(page: Page) {
	return page.evaluate(() => {
		const canvas = document.querySelector<HTMLCanvasElement>('[data-photo-pyramid] canvas');
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return null;
		const [red, green, blue] = context.getImageData(
			Math.floor(canvas.width / 2),
			Math.floor(canvas.height / 2),
			1,
			1
		).data;
		return { red, green, blue };
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

test('the before toggle and the hold key both render the photograph without its edits', async ({
	page
}) => {
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
	await expect(page.locator('[data-photo-pyramid] canvas')).toBeVisible();
	await page.keyboard.press('1');

	const centreRed = async () => (await viewportCentrePixel(page))?.red ?? 0;
	await expect.poll(centreRed, { timeout: 20_000 }).toBeGreaterThan(0);
	const original = await centreRed();

	await exposure.fill('2');
	await exposure.press('Enter');
	await expect.poll(centreRed, { timeout: 20_000 }).toBeGreaterThan(original + 20);
	const brightened = await centreRed();

	const toggle = page.getByRole('button', { name: /^(before|after)$/ });
	await expect(toggle).toHaveText('after');
	await toggle.click();
	await expect(toggle).toHaveText('before');
	await expect(page.getByText('before', { exact: true }).last()).toBeVisible();
	await expect.poll(centreRed, { timeout: 20_000 }).toBeLessThan(brightened - 20);

	await toggle.click();
	await expect(toggle).toHaveText('after');
	await expect.poll(centreRed, { timeout: 20_000 }).toBeGreaterThan(original + 20);

	await page.keyboard.down('\\');
	await expect(toggle).toHaveText('before');
	await expect.poll(centreRed, { timeout: 20_000 }).toBeLessThan(brightened - 20);

	await page.keyboard.up('\\');
	await expect(toggle).toHaveText('after');
	await expect.poll(centreRed, { timeout: 20_000 }).toBeGreaterThan(original + 20);
	await expect(exposure).toHaveValue('+2.00 EV');
});

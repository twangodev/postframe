import { expect, test } from '@playwright/test';

test('keeps every shaped curve on the plot while the chip picks the editable one', async ({
	page
}) => {
	await page.setViewportSize({ width: 1600, height: 1200 });
	await page.goto('/?perf');
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 96;
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, '#101820');
		gradient.addColorStop(0.5, '#c8552a');
		gradient.addColorStop(1, '#f4f4f0');
		context.fillStyle = gradient;
		context.fillRect(0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/png');
	});
	await page
		.locator('main input[type="file"]')
		.first()
		.setInputFiles({
			name: 'curve.png',
			mimeType: 'image/png',
			buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
		});
	await page.getByRole('tab', { name: 'edit', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Exposure value' })).toBeEnabled({
		timeout: 20_000
	});

	await page.getByRole('button', { name: /^Curve/ }).click();
	const plot = page.getByRole('application', { name: /tone curve/ });
	await plot.scrollIntoViewIfNeeded();
	await expect(plot).toBeVisible();

	const histogramBackdrop = plot.locator('polygon');
	await expect(histogramBackdrop).toHaveCount(1);
	await expect(page.getByRole('radio', { name: 'luminance curve' })).toHaveAttribute(
		'aria-checked',
		'true'
	);

	const shape = async (fromY: number, toY: number) => {
		await plot.scrollIntoViewIfNeeded();
		const box = (await plot.boundingBox())!;
		await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * fromY);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * toY, { steps: 8 });
		await page.mouse.up();
	};

	const drawnCurves = plot.locator('polyline');
	const headerNamingTheShapedChannels = (channels: string) =>
		page.getByRole('button', { name: new RegExp(`^Curve\\s*${channels}$`) });
	await shape(0.6, 0.45);
	await expect(drawnCurves).toHaveCount(1);
	await expect(headerNamingTheShapedChannels('L')).toBeVisible();

	await page.getByRole('radio', { name: 'red curve' }).click();
	await expect(plot).toHaveAttribute('aria-label', 'red tone curve');
	await shape(0.35, 0.2);

	await expect(drawnCurves).toHaveCount(2);
	await expect(headerNamingTheShapedChannels('LR')).toBeVisible();
});

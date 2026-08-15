export function applePlatform() {
	if (typeof navigator === 'undefined') return false;
	const platform =
		(navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
		navigator.platform ??
		'';
	return /mac|iphone|ipad|ipod/i.test(platform);
}

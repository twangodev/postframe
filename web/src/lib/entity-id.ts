export function entityId(prefix: string) {
	return `${prefix}-${crypto.randomUUID()}`;
}

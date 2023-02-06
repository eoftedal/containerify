export function unique(vals: string[]): string[] {
	return [...new Set(vals)];
}

export function omit<T>(
	obj: Record<string, T>,
	keys: string[],
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(obj).filter(([k]) => !keys.includes(k)),
	);
}

/** Where to go after signing in or up, from a `next` query parameter. Only paths on this site, never `//host`. */
export function safeNext(value: string | null, fallback = '/dashboard'): string {
	return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : fallback;
}

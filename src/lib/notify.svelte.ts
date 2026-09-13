import { isHttpError } from '@sveltejs/kit';

/** User-facing text for a caught error. Remote functions reject with HttpError, which is not an Error. */
export function errorMessage(err: unknown, fallback = 'Noe gikk galt. Prøv igjen.'): string {
	if (isHttpError(err)) return err.body.message;
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}

export const toasts = $state<{ id: number; message: string }[]>([]);
let nextId = 0;

export function showError(err: unknown) {
	const id = nextId++;
	toasts.push({ id, message: errorMessage(err) });
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id);
		if (i !== -1) toasts.splice(i, 1);
	}, 6000);
}

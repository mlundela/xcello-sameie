/** Base64 content of a file, without the `data:...;base64,` prefix. */
export function readAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve((reader.result as string).split(',')[1]);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

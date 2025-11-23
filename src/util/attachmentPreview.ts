/**
 * Downloads an attachment and wraps it in a Blob that is typed as MP4 so browsers
 * route playback through the MP4 pipeline regardless of the original container headers.
 */
export async function downloadVideoAttachmentAsMp4Blob(url: string): Promise<Blob> {
	const res = await fetch(url, {credentials: "include"});
	if(!res.ok) {
		throw new Error(`Failed to download attachment: ${res.status} ${res.statusText}`);
	}

	const buffer = await res.arrayBuffer();
	return new Blob([buffer], {type: "video/mp4"});
}

/**
 * Re-label an existing blob or byte buffer as MP4 without copying when possible.
 */
export function coerceBlobToMp4(data: Blob | ArrayBuffer | Uint8Array): Blob {
	if(data instanceof Blob) {
		return new Blob([data], {type: "video/mp4"});
	}
	if(data instanceof ArrayBuffer) {
		return new Blob([data], {type: "video/mp4"});
	}
	return new Blob([data.buffer], {type: "video/mp4"});
}

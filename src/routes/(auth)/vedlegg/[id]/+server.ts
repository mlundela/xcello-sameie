import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { requireOrgId } from '$lib/server/tenant';
import { attachment } from '$lib/schema';
import type { RequestHandler } from './$types';

// Receipts are stored base64 in Postgres and can be 10 MB each, so queries return metadata only
// and the bytes are sent when someone opens the file.
export const GET: RequestHandler = async ({ params }) => {
	const orgId = requireOrgId();
	const [row] = await db
		.select({ fileName: attachment.fileName, mimeType: attachment.mimeType, content: attachment.content })
		.from(attachment)
		.where(and(eq(attachment.id, params.id), eq(attachment.organizationId, orgId)))
		.limit(1);
	if (!row) error(404, 'Vedlegget finnes ikke');

	return new Response(new Uint8Array(Buffer.from(row.content, 'base64')), {
		headers: {
			// upload_attachment only accepts PDF, JPEG, PNG and WebP
			'Content-Type': row.mimeType,
			'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, max-age=3600'
		}
	});
};

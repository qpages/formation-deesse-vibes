import type { APIRoute } from 'astro';

export const prerender = true;

const PUBLIC_PATHS = ['/'] as const;

export const GET: APIRoute = ({ site }) => {
	const origin = site ?? new URL('https://formation.jessica-stamck.com');
	const urls = PUBLIC_PATHS.map((path) => {
		const loc = new URL(path, origin).href;
		return `  <url>\n    <loc>${loc}</loc>\n  </url>`;
	}).join('\n');

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
		},
	});
};

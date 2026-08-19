import type { APIRoute } from 'astro';

export const prerender = true;

function robotsTxt(sitemapURL: URL): string {
	return `User-agent: *
Allow: /

Disallow: /admin
Disallow: /api/

Sitemap: ${sitemapURL.href}
`;
}

export const GET: APIRoute = ({ site }) => {
	const origin = site ?? new URL('https://formation.jessica-stamck.com');
	const sitemapURL = new URL('sitemap.xml', origin);
	return new Response(robotsTxt(sitemapURL), {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
		},
	});
};

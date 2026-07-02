import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
    const robotTxt = `User-agent: *
Allow: /
Sitemap: ${new URL('sitemap-index.xml', site).href}`;
    return new Response(robotTxt);
};

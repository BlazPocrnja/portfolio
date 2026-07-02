import { Resvg } from "@resvg/resvg-js";

const getLang = (pathname) => {
	for (const lang of ['en', 'zh-hant', 'ja', 'ko']) {
		if (pathname.indexOf(`/${lang}/`) === 0) return lang
	}
	return 'zh';
}

export default async function(context) {
	// Generate a simple colored placeholder PNG for OG images
	// Customize this with your design later using GSAP
	const svg = `
		<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
			<rect width="1200" height="630" fill="#1d1f21"/>
			<text x="600" y="315" font-size="48" fill="#c9cacc" text-anchor="middle" dominant-baseline="middle">
				Portfolio OG Image
			</text>
		</svg>
	`;
	const png = new Resvg(svg).render().asPng();
	return [png, {
	  headers: {
			"Cache-Control": "public, max-age=31536000, immutable",
			"Content-Type": "image/png",
		},
	}];
}

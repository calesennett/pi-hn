import { parseHTML } from "linkedom";

function escapeHtmlText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function normalizeHtmlForLinkedom(html: string): string {
	const hasHtmlTag = /<html\b/i.test(html);
	const hasBodyTag = /<body\b/i.test(html);
	if (hasHtmlTag && hasBodyTag) return html;

	const hasHtmlLikeTag = /<[a-z][\w:-]*(?:\s|>|\/)/i.test(html);
	if (!hasHtmlLikeTag) {
		return `<!doctype html><html><head></head><body><pre>${escapeHtmlText(html)}</pre></body></html>`;
	}

	const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
	const titleMatch = html.match(/<title\b[^>]*>[\s\S]*?<\/title>/i);
	const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)(?:<\/body>|$)/i);
	const head = headMatch?.[1] ?? titleMatch?.[0] ?? "";
	const body = bodyMatch?.[1] ?? html
		.replace(/<!doctype[^>]*>/i, "")
		.replace(/<\/?html\b[^>]*>/gi, "")
		.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, "")
		.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, "");

	return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

export function createArticleWindow(html: string): ReturnType<typeof parseHTML> {
	return parseHTML(normalizeHtmlForLinkedom(html));
}

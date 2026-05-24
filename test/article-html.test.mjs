import test from 'node:test';
import assert from 'node:assert/strict';
import { Readability } from '@mozilla/readability';
import { createArticleWindow, normalizeHtmlForLinkedom } from '../extensions/article-html.ts';

function readableText(html) {
	const dom = createArticleWindow(html);
	const fallbackDom = createArticleWindow(html);
	fallbackDom.document.querySelectorAll('script, style').forEach((node) => node.remove());
	const fallbackText = fallbackDom.document.body?.textContent?.trim() ?? '';
	return (new Readability(dom.document).parse()?.textContent ?? fallbackText).trim();
}

test('wraps HTML fragments so body text remains readable', () => {
	const text = readableText('<article><h1>Example</h1><p>Fragment content remains visible to readability and fallback extraction.</p></article>');
	assert.match(text, /Fragment content remains visible/);
});

test('repairs implicit-body documents while preserving title metadata', () => {
	const dom = createArticleWindow('<!doctype html><html><head><title>Example Title</title></head><article><p>Implicit body content remains readable.</p></article></html>');
	assert.equal(dom.document.title, 'Example Title');
	assert.match(dom.document.body?.textContent ?? '', /Implicit body content remains readable/);
});

test('preserves plain text responses as body text', () => {
	const dom = createArticleWindow('Plain text content remains readable without markup.');
	assert.match(dom.document.body?.textContent ?? '', /Plain text content remains readable/);
});

test('leaves complete html/body documents unchanged', () => {
	const html = '<!doctype html><html><head><title>Complete</title></head><body><p>Body</p></body></html>';
	assert.equal(normalizeHtmlForLinkedom(html), html);
});

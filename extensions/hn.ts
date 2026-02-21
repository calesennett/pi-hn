import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Readability } from "@mozilla/readability";
import { Container, SelectList, Text } from "@mariozechner/pi-tui";
import { JSDOM, VirtualConsole } from "jsdom";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HN_FRONT_PAGE_API = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30";
const ARTICLE_CONTEXT_MESSAGE_TYPE = "hn-article-context";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface ReadableArticle {
	title: string;
	url: string;
	byline: string | null;
	siteName: string | null;
	excerpt: string | null;
	textContent: string;
	length: number;
}

interface ArticleContextDetails {
	hnId: string;
	title: string;
	url: string;
	siteName: string | null;
	byline: string | null;
	length: number;
	charCount: number;
	fetchedAt: string;
}

interface HNHit {
	title: string | null;
	points: number | null;
	num_comments: number | null;
	url: string | null;
	objectID: string;
}

interface HNRawHit {
	title?: string | null;
	points?: number | null;
	num_comments?: number | null;
	url?: string | null;
	objectID?: string | null;
	objectId?: string | null;
}

interface HNResponse {
	hits: HNRawHit[];
}

interface PersistResult {
	ok: boolean;
	error?: string;
}

interface ReadLookupResult {
	ok: boolean;
	readIds: Set<string>;
	error?: string;
}

interface StoredArticle {
	id: number;
	hn_id: string;
	title: string | null;
	url: string | null;
	read_at: number | null;
	first_seen_at: number;
	last_seen_at: number;
	created_at: number;
	updated_at: number;
}

interface ArticleStore {
	next_id: number;
	articles: StoredArticle[];
}

function getPiAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (configured && configured.length > 0) return configured;
	return join(homedir(), ".pi", "agent");
}

const HN_STORE_PATH = join(getPiAgentDir(), "data", "pi-hn", "db.json");
let isStoreInitialized = false;
let storeInitError: string | null = null;

function nowUnix(): number {
	return Math.floor(Date.now() / 1000);
}

function emptyStore(): ArticleStore {
	return {
		next_id: 1,
		articles: [],
	};
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return "Unknown error";
}

function readStore(): ArticleStore {
	if (!existsSync(HN_STORE_PATH)) {
		return emptyStore();
	}

	const raw = readFileSync(HN_STORE_PATH, "utf8").trim();
	if (raw.length === 0) return emptyStore();

	const parsed = JSON.parse(raw) as Partial<ArticleStore>;
	if (!Array.isArray(parsed.articles) || typeof parsed.next_id !== "number") {
		throw new Error("Invalid JSON store format");
	}

	return {
		next_id: parsed.next_id,
		articles: parsed.articles,
	};
}

function writeStore(store: ArticleStore): void {
	mkdirSync(dirname(HN_STORE_PATH), { recursive: true });
	const tmpPath = `${HN_STORE_PATH}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
	renameSync(tmpPath, HN_STORE_PATH);
}

function ensureStore(): PersistResult {
	if (isStoreInitialized) return { ok: true };

	try {
		mkdirSync(dirname(HN_STORE_PATH), { recursive: true });
		if (!existsSync(HN_STORE_PATH)) {
			writeStore(emptyStore());
		} else {
			void readStore();
		}
		isStoreInitialized = true;
		storeInitError = null;
		return { ok: true };
	} catch (error) {
		storeInitError = getErrorMessage(error);
		return { ok: false, error: storeInitError };
	}
}

function persistFetchedArticles(hits: HNHit[]): PersistResult {
	if (hits.length === 0) return { ok: true };

	const ready = ensureStore();
	if (!ready.ok) return ready;

	try {
		const store = readStore();
		const now = nowUnix();
		const existingByHnId = new Map(store.articles.map((article) => [article.hn_id, article]));

		for (const hit of hits) {
			const existing = existingByHnId.get(hit.objectID);
			if (existing) {
				existing.title = hit.title ?? null;
				existing.url = hit.url ?? null;
				existing.last_seen_at = now;
				existing.updated_at = now;
				continue;
			}

			store.articles.push({
				id: store.next_id,
				hn_id: hit.objectID,
				title: hit.title ?? null,
				url: hit.url ?? null,
				read_at: null,
				first_seen_at: now,
				last_seen_at: now,
				created_at: now,
				updated_at: now,
			});
			store.next_id += 1;
		}

		writeStore(store);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: getErrorMessage(error) };
	}
}

function persistReadArticles(hits: HNHit[]): PersistResult {
	if (hits.length === 0) return { ok: true };

	const ready = ensureStore();
	if (!ready.ok) return ready;

	try {
		const store = readStore();
		const now = nowUnix();
		const existingByHnId = new Map(store.articles.map((article) => [article.hn_id, article]));

		for (const hit of hits) {
			const existing = existingByHnId.get(hit.objectID);
			if (existing) {
				existing.title = hit.title ?? null;
				existing.url = hit.url ?? null;
				existing.read_at = existing.read_at ?? now;
				existing.last_seen_at = now;
				existing.updated_at = now;
				continue;
			}

			store.articles.push({
				id: store.next_id,
				hn_id: hit.objectID,
				title: hit.title ?? null,
				url: hit.url ?? null,
				read_at: now,
				first_seen_at: now,
				last_seen_at: now,
				created_at: now,
				updated_at: now,
			});
			store.next_id += 1;
		}

		writeStore(store);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: getErrorMessage(error) };
	}
}

function loadReadArticleIds(hits: HNHit[]): ReadLookupResult {
	if (hits.length === 0) return { ok: true, readIds: new Set<string>() };

	const ready = ensureStore();
	if (!ready.ok) return { ok: false, readIds: new Set<string>(), error: ready.error };

	try {
		const store = readStore();
		const currentHitIds = new Set(hits.map((hit) => hit.objectID));
		const readIds = new Set(
			store.articles
				.filter((article) => article.read_at !== null && currentHitIds.has(article.hn_id))
				.map((article) => article.hn_id),
		);
		return { ok: true, readIds };
	} catch (error) {
		return { ok: false, readIds: new Set<string>(), error: getErrorMessage(error) };
	}
}

function normalizeTitle(title: string | null | undefined): string {
	const normalized = (title ?? "").replace(/\s+/g, " ").trim();
	return normalized.length > 0 ? normalized : "(untitled)";
}

function formatListLabel(hit: HNHit, isRead: boolean): string {
	const points = typeof hit.points === "number" ? hit.points : 0;
	const comments = typeof hit.num_comments === "number" ? hit.num_comments : 0;
	const marker = isRead ? "✓ " : "  ";
	return `${marker}${normalizeTitle(hit.title)} (${points} points, ${comments} comments)`;
}

function commentsUrl(hit: HNHit): string {
	return `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`;
}

function normalizeArticleText(text: string): string {
	return text
		.replace(/\u00a0/g, " ")
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function createArticleDom(html: string, url: string): JSDOM {
	const virtualConsole = new VirtualConsole();
	virtualConsole.on("jsdomError", (error) => {
		if (error instanceof Error && error.message.includes("Could not parse CSS stylesheet")) return;
		console.error(error);
	});
	return new JSDOM(html, { url, virtualConsole });
}

async function fetchReadableArticle(url: string): Promise<ReadableArticle> {
	const response = await fetch(url, {
		headers: {
			accept: "text/html,application/xhtml+xml",
			"user-agent": "pi-hn/0.1",
		},
	});
	if (!response.ok) {
		throw new Error(`Article request returned ${response.status}`);
	}

	const html = await response.text();
	const resolvedUrl = response.url || url;
	const dom = createArticleDom(html, resolvedUrl);
	const fallbackDom = createArticleDom(html, resolvedUrl);
	fallbackDom.window.document.querySelectorAll("script, style").forEach((node) => node.remove());
	const fallbackText = normalizeArticleText(fallbackDom.window.document.body?.textContent ?? "");
	const parsed = new Readability(dom.window.document).parse();
	const textContent = normalizeArticleText(parsed?.textContent ?? fallbackText);
	if (textContent.length === 0) {
		throw new Error("Article had no readable text content");
	}

	return {
		title: normalizeTitle(parsed?.title ?? dom.window.document.title),
		url: resolvedUrl,
		byline: parsed?.byline?.trim() || null,
		siteName: parsed?.siteName?.trim() || null,
		excerpt: parsed?.excerpt?.trim() || null,
		textContent,
		length: parsed?.length ?? textContent.length,
	};
}

function buildArticleContext(hit: HNHit, article: ReadableArticle): { content: string; details: ArticleContextDetails } {
	const title = article.title === "(untitled)" ? normalizeTitle(hit.title) : article.title;
	const lines: string[] = [
		`Title: ${title}`,
		`URL: ${article.url}`,
		`HN Comments: ${commentsUrl(hit)}`,
	];

	if (article.siteName) lines.push(`Site: ${article.siteName}`);
	if (article.byline) lines.push(`Byline: ${article.byline}`);
	if (article.excerpt) lines.push(`Excerpt: ${article.excerpt}`);
	lines.push("", "Article Text:", article.textContent);

	return {
		content: lines.join("\n"),
		details: {
			hnId: hit.objectID,
			title,
			url: article.url,
			siteName: article.siteName,
			byline: article.byline,
			length: article.length,
			charCount: article.textContent.length,
			fetchedAt: new Date().toISOString(),
		},
	};
}

async function openInBrowser(pi: ExtensionAPI, url: string): Promise<{ ok: boolean; error?: string }> {
	const windowsQuotedUrl = `"${url.replace(/"/g, '""')}"`;
	const result =
		process.platform === "darwin"
			? await pi.exec("open", [url])
			: process.platform === "win32"
				? await pi.exec("cmd", ["/c", "start", "", windowsQuotedUrl])
				: await pi.exec("xdg-open", [url]);

	if (result.code !== 0) {
		return {
			ok: false,
			error: result.stderr.trim() || `Failed to open URL (exit code ${result.code})`,
		};
	}

	return { ok: true };
}

async function fetchFrontPage(): Promise<HNHit[]> {
	const response = await fetch(HN_FRONT_PAGE_API);
	if (!response.ok) {
		throw new Error(`Hacker News API returned ${response.status}`);
	}

	const data = (await response.json()) as Partial<HNResponse>;
	if (!Array.isArray(data.hits)) return [];

	return data.hits
		.map((hit) => {
			const objectID = hit.objectID ?? hit.objectId;
			if (!objectID) return undefined;
			return {
				title: hit.title ?? null,
				points: hit.points ?? 0,
				num_comments: hit.num_comments ?? 0,
				url: hit.url ?? null,
				objectID,
			} as HNHit;
		})
		.filter((hit): hit is HNHit => Boolean(hit))
		.sort((a, b) => {
			const pointsDiff = (b.points ?? 0) - (a.points ?? 0);
			if (pointsDiff !== 0) return pointsDiff;

			return (b.num_comments ?? 0) - (a.num_comments ?? 0);
		});
}

export default function hackerNewsExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer(ARTICLE_CONTEXT_MESSAGE_TYPE, (message, { expanded }, theme) => {
		const details = (message.details ?? {}) as Partial<ArticleContextDetails>;
		const title = details.title ?? "(untitled)";
		const charCount = typeof details.charCount === "number" ? details.charCount : undefined;
		const charLabel =
			typeof charCount === "number" ? theme.fg("dim", ` (${charCount.toLocaleString()} chars)`) : "";

		let text = `${theme.bold(`[${title}]`)}${charLabel}`;
		if (expanded) {
			if (details.url) text += `\n${theme.fg("muted", `URL: ${details.url}`)}`;
			if (details.siteName) text += `\n${theme.fg("muted", `Site: ${details.siteName}`)}`;
			if (details.byline) text += `\n${theme.fg("muted", `Byline: ${details.byline}`)}`;
			if (details.fetchedAt) {
				text += `\n${theme.fg("dim", `Fetched: ${new Date(details.fetchedAt).toLocaleString()}`)}`;
			}
		}

		return new Text(text, 0, 0);
	});

	pi.registerCommand("hn", {
		description: "Browse Hacker News front page (a/enter=article, x=add context, c=comments)",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			let hits: HNHit[];
			try {
				hits = await fetchFrontPage();
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				ctx.ui.notify(`Failed to load Hacker News front page: ${message}`, "error");
				return;
			}

			if (hits.length === 0) {
				ctx.ui.notify("Hacker News front page returned no items.", "warning");
				return;
			}

			const persistedFetches = persistFetchedArticles(hits);
			if (!persistedFetches.ok) {
				ctx.ui.notify(
					`Could not persist fetched articles to ${HN_STORE_PATH}: ${persistedFetches.error ?? "Unknown error"}`,
					"warning",
				);
			}

			const readLookup = loadReadArticleIds(hits);
			if (!readLookup.ok) {
				ctx.ui.notify(
					`Could not load read-article state from ${HN_STORE_PATH}: ${readLookup.error ?? "Unknown error"}`,
					"warning",
				);
			}
			const readArticleIds = readLookup.readIds;

			const hitsById = new Map(hits.map((hit) => [hit.objectID, hit]));

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const items = hits.map((hit) => ({
					value: hit.objectID,
					label: formatListLabel(hit, readArticleIds.has(hit.objectID)),
				}));
				const itemsById = new Map(items.map((item) => [item.value, item]));

				const pendingReadHits = new Map<string, HNHit>();
				let uiClosed = false;
				const hintText = [
					`${theme.fg("dim", theme.bold("↑↓/j/k"))} ${theme.fg("dim", "navigate")}`,
					`${theme.fg("dim", theme.bold("enter/a"))} ${theme.fg("dim", "article")}`,
					`${theme.fg("dim", theme.bold("x"))} ${theme.fg("dim", "add to context")}`,
					`${theme.fg("dim", theme.bold("c"))} ${theme.fg("dim", "comments")}`,
					`${theme.fg("dim", theme.bold("esc"))} ${theme.fg("dim", "close")}`,
				].join(theme.fg("dim", " • "));
				const hint = new Text(hintText);
				let contextLoadHit: HNHit | null = null;
				let spinnerFrame = 0;
				let spinnerTimer: ReturnType<typeof setInterval> | undefined;

				const flushPendingReads = () => {
					if (pendingReadHits.size === 0) return;

					const result = persistReadArticles([...pendingReadHits.values()]);
					if (!result.ok) {
						ctx.ui.notify(
							`Could not persist read articles to ${HN_STORE_PATH}: ${result.error ?? "Unknown error"}`,
							"warning",
						);
						return;
					}
					pendingReadHits.clear();
				};

				const setHint = (text: string) => {
					hint.setText(text);
					hint.invalidate();
					if (!uiClosed) tui.requestRender();
				};

				const updateHint = (text: string, color: "dim" | "warning" = "dim") => {
					setHint(theme.fg(color, text));
				};

				const stopContextSpinner = () => {
					if (spinnerTimer) {
						clearInterval(spinnerTimer);
						spinnerTimer = undefined;
					}
					contextLoadHit = null;
					spinnerFrame = 0;
					setHint(hintText);
				};

				const startContextSpinner = (hit: HNHit) => {
					contextLoadHit = hit;
					spinnerFrame = 0;
					const animate = () => {
						const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? "*";
						spinnerFrame += 1;
						updateHint(`${frame} fetching article and adding to session context...`, "warning");
					};
					animate();
					spinnerTimer = setInterval(animate, 110);
				};

				const closeUi = () => {
					if (uiClosed) return;
					uiClosed = true;
					stopContextSpinner();
					flushPendingReads();
					done();
				};

				const container = new Container();
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Hacker News"))));

				const selectList = new SelectList(items, Math.min(items.length, 15), {
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				});
				let selectedIndex = 0;
				selectList.onSelectionChange = (item) => {
					selectedIndex = Math.max(
						0,
						items.findIndex((candidate) => candidate.value === item.value),
					);
				};

				const getSelectedHit = (): HNHit | undefined => {
					const selected = selectList.getSelectedItem();
					if (!selected) return undefined;
					return hitsById.get(selected.value);
				};

				const markHitRead = (hit: HNHit) => {
					pendingReadHits.set(hit.objectID, hit);
					readArticleIds.add(hit.objectID);

					if (uiClosed) {
						flushPendingReads();
						return;
					}

					const item = itemsById.get(hit.objectID);
					if (item) {
						item.label = formatListLabel(hit, true);
						selectList.invalidate();
						tui.requestRender();
					}
					if (pendingReadHits.size >= 10) {
						flushPendingReads();
					}
				};

				const openSelectedArticle = async () => {
					const hit = getSelectedHit();
					if (!hit) return;
					if (!hit.url) {
						ctx.ui.notify("This item has no article URL.", "warning");
						return;
					}

					const result = await openInBrowser(pi, hit.url);
					if (!result.ok) {
						ctx.ui.notify(`Could not open article: ${result.error ?? "Unknown error"}`, "error");
						return;
					}

					markHitRead(hit);
				};

				const addSelectedArticleToContext = async () => {
					const hit = getSelectedHit();
					if (!hit) return;
					if (!hit.url) {
						ctx.ui.notify("This item has no article URL.", "warning");
						return;
					}
					if (contextLoadHit) {
						ctx.ui.notify(`Already fetching: ${normalizeTitle(contextLoadHit.title)}`, "warning");
						return;
					}

					startContextSpinner(hit);
					try {
						const article = await fetchReadableArticle(hit.url);
						if (uiClosed) return;
						const contextMessage = buildArticleContext(hit, article);
						pi.sendMessage(
							{
								customType: ARTICLE_CONTEXT_MESSAGE_TYPE,
								content: contextMessage.content,
								details: contextMessage.details,
								display: true,
							},
							{ triggerTurn: false },
						);
						markHitRead(hit);
						const addedTitle = article.title === "(untitled)" ? normalizeTitle(hit.title) : article.title;
						ctx.ui.notify(`Added to session context: ${addedTitle}`, "info");
					} catch (error) {
						if (!uiClosed) {
							ctx.ui.notify(`Could not add article to context: ${getErrorMessage(error)}`, "error");
						}
					} finally {
						stopContextSpinner();
					}
				};

				const openSelectedComments = async () => {
					const hit = getSelectedHit();
					if (!hit) return;

					const result = await openInBrowser(pi, commentsUrl(hit));
					if (!result.ok) {
						ctx.ui.notify(`Could not open comments: ${result.error ?? "Unknown error"}`, "error");
					}
				};

				selectList.onSelect = () => {
					void openSelectedArticle();
				};
				selectList.onCancel = () => closeUi();

				container.addChild(selectList);
				container.addChild(hint);
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						if (data === "x" || data === "X") {
							void addSelectedArticleToContext();
							return;
						}
						if (data === "a" || data === "A") {
							void openSelectedArticle();
							return;
						}
						if (data === "c" || data === "C") {
							void openSelectedComments();
							return;
						}
						if (data === "j" || data === "J") {
							selectedIndex = (selectedIndex + 1) % items.length;
							selectList.setSelectedIndex(selectedIndex);
							tui.requestRender();
							return;
						}
						if (data === "k" || data === "K") {
							selectedIndex = (selectedIndex - 1 + items.length) % items.length;
							selectList.setSelectedIndex(selectedIndex);
							tui.requestRender();
							return;
						}

						selectList.handleInput(data);
						tui.requestRender();
					},
				};
			});
		},
	});
}

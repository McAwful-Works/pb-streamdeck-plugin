/**
 * HTTP helpers for PhantomBot's authenticated panel API (command execution and connection checks).
 *
 * @module
 */
import { Agent, type RequestInit, fetch as undiciFetch } from "undici";

/**
 * Creates an Undici `Agent` with `rejectUnauthorized: false` when insecure HTTPS is requested.
 *
 * Each agent owns a connection pool, so callers must close the one they are handed once their
 * requests are done; building a fresh agent per request accumulates keep-alive sockets in a
 * long-lived plugin process.
 *
 * @param allowInsecureTls Whether the user opted into skipping certificate verification.
 * @returns An agent to dispatch with, or `undefined` to use Undici's global dispatcher.
 */
function createInsecureTlsAgent(allowInsecureTls: boolean | undefined): Agent | undefined {
	if (!allowInsecureTls) return undefined;
	return new Agent({
		connect: { rejectUnauthorized: false },
	});
}

/** Attaches `dispatcher` to a request init when an insecure-TLS agent is in play. */
function withDispatcher(init: RequestInit, dispatcher: Agent | undefined): RequestInit {
	if (!dispatcher) return init;
	return { ...init, dispatcher };
}

/**
 * Closes an insecure-TLS agent, releasing its pooled sockets.
 *
 * Deliberately not awaited: teardown must not delay the caller's result or replace an
 * in-flight error with a close failure.
 */
function closeAgent(dispatcher: Agent | undefined): void {
	void dispatcher?.close().catch(() => {});
}

/** Options for {@link sendPhantomCommand}. */
export type SendPhantomCommandOptions = {
	baseUrl: string;
	/** PhantomBot panel webauth token. */
	webauth: string;
	phantomUser: string;
	message: string;
	/** Skip TLS certificate verification for HTTPS only (insecure). */
	allowInsecureTls?: boolean;
};

/**
 * Sends a chat command to PhantomBot via authenticated `PUT /dbquery`.
 * PhantomBot runs chat commands when the `message` header starts with `!`; callers should pass text accordingly.
 *
 * @param options Base URL, auth headers, command text, and optional TLS behavior.
 * @returns HTTP outcome: `ok` mirrors `fetch` response ok, plus status code and response body text.
 * @see https://github.com/PhantomBot/PhantomBot/blob/master/source/tv/phantombot/httpserver/HTTPAuthenticatedHandler.java
 */
export async function sendPhantomCommand(
	options: SendPhantomCommandOptions,
): Promise<{ ok: boolean; status: number; body: string }> {
	const base = options.baseUrl.replace(/\/$/, "");
	const url = `${base}/dbquery`;

	const headers: Record<string, string> = {
		user: options.phantomUser,
		message: options.message,
		webauth: options.webauth,
	};

	const dispatcher = createInsecureTlsAgent(options.allowInsecureTls);

	try {
		const res = await undiciFetch(url, withDispatcher({ method: "PUT", headers }, dispatcher));
		const body = await res.text();
		return { ok: res.ok, status: res.status, body };
	} finally {
		closeAgent(dispatcher);
	}
}

/** Options for {@link testPhantomBotConnection}. */
export type TestPhantomBotConnectionOptions = {
	baseUrl: string;
	/** PhantomBot panel webauth token. */
	webauth: string;
	/** Skip TLS certificate verification for HTTPS only (insecure). */
	allowInsecureTls?: boolean;
};

/**
 * Client-side timeout applied to **each** connection probe independently.
 *
 * Both probes run sequentially, so the worst case a caller can observe is twice this value.
 * That ceiling must stay below the property inspector's 15s watchdog (`ui/phantomControl.html`),
 * which otherwise reports "No response" while the plugin is still waiting.
 */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * Issues a single probe request under its own abort budget.
 *
 * Each probe gets a fresh {@link AbortController} so a slow first probe cannot consume the
 * budget of the one after it.
 *
 * @param url Absolute URL to probe.
 * @param init Request init (method, headers, and optional insecure-TLS dispatcher).
 * @returns Status code and response body text.
 * @throws `AbortError` when the request exceeds {@link PROBE_TIMEOUT_MS}, or the underlying
 * network error when the request fails outright.
 */
async function probeWithTimeout(url: string, init: RequestInit): Promise<{ status: number; body: string }> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

	try {
		const res = await undiciFetch(url, { ...init, signal: controller.signal });
		const body = await res.text();
		return { status: res.status, body };
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Checks that the bot URL and webauth token work using a two-step compatibility probe:
 * 1) `HEAD /dbquery` expecting **405** (PhantomBot 3.7+ behavior),
 * 2) fallback for older bots: `GET /dbquery?table=modules&tableExists` expecting **200**.
 *
 * Each step carries its own {@link PROBE_TIMEOUT_MS} budget, so a slow bot on step 1 still
 * leaves step 2 a full timeout to answer in.
 *
 * Any step-1 status other than 405 (or a known-bad auth status) is treated as "this bot may be
 * an older build" and falls through to step 2, so a step-1 error is only reported to the user
 * when step 2 fails too.
 *
 * @param options Base URL, webauth header, and optional insecure HTTPS mode.
 * @returns `ok` is true when either compatibility probe returns its expected status.
 * @throws `AbortError` on timeout, or the underlying network error; callers surface these to the user.
 */
export async function testPhantomBotConnection(
	options: TestPhantomBotConnectionOptions,
): Promise<{ ok: boolean; status: number; body: string }> {
	const base = options.baseUrl.replace(/\/$/, "");
	const headUrl = `${base}/dbquery`;
	const legacyGetUrl = `${base}/dbquery?table=modules&tableExists`;
	const headers: Record<string, string> = { webauth: options.webauth };

	const dispatcher = createInsecureTlsAgent(options.allowInsecureTls);

	try {
		const headRes = await probeWithTimeout(headUrl, withDispatcher({ method: "HEAD", headers }, dispatcher));
		if (headRes.status === 405) {
			return { ok: true, status: headRes.status, body: headRes.body };
		}

		// Auth is known-bad; skip legacy fallback to avoid hiding real auth failures.
		if (headRes.status === 401 || headRes.status === 403) {
			return { ok: false, status: headRes.status, body: headRes.body };
		}

		const legacyRes = await probeWithTimeout(legacyGetUrl, withDispatcher({ method: "GET", headers }, dispatcher));
		return { ok: legacyRes.status === 200, status: legacyRes.status, body: legacyRes.body };
	} finally {
		closeAgent(dispatcher);
	}
}

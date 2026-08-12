import { afterEach, describe, expect, it } from "vitest";

import { startPhantomBotLikeHttpServer, startPhantomBotLikeHttpsServer } from "./integration/phantomBotTestServer";
import { sendPhantomCommand, testPhantomBotConnection } from "./phantomBot";

describe("phantomBot (integration, real HTTP)", () => {
	let server: Awaited<ReturnType<typeof startPhantomBotLikeHttpServer>>;

	afterEach(async () => {
		if (server) await server.close();
	});

	it("testPhantomBotConnection succeeds against HEAD /dbquery with 405 and valid webauth", async () => {
		server = await startPhantomBotLikeHttpServer({});
		const result = await testPhantomBotConnection({
			baseUrl: server.baseUrl,
			webauth: server.expectedWebauth,
		});
		expect(result).toEqual({ ok: true, status: 405, body: "" });
	});

	// A non-405 status on HEAD is treated as "possibly an older bot", so a server error there is
	// deliberately not fatal on its own: the legacy probe decides the outcome.
	it("falls back to the legacy probe when HEAD returns a server error", async () => {
		server = await startPhantomBotLikeHttpServer({ headDbQueryStatus: 503 });
		const result = await testPhantomBotConnection({
			baseUrl: server.baseUrl,
			webauth: server.expectedWebauth,
		});
		expect(result).toEqual({
			ok: true,
			status: 200,
			body: '{"table":{"table_name":"modules","exists":true}}',
		});
	});

	it("surfaces the bot's HTTP error when HEAD and the legacy probe both fail", async () => {
		server = await startPhantomBotLikeHttpServer({
			headDbQueryStatus: 503,
			legacyDbQueryStatus: 503,
			legacyDbQueryBody: "bot unavailable",
		});
		const result = await testPhantomBotConnection({
			baseUrl: server.baseUrl,
			webauth: server.expectedWebauth,
		});
		expect(result).toEqual({ ok: false, status: 503, body: "bot unavailable" });
	});

	it("falls back for older PhantomBot behavior when HEAD does not return 405", async () => {
		server = await startPhantomBotLikeHttpServer({ headDbQueryStatus: 404 });
		const result = await testPhantomBotConnection({
			baseUrl: server.baseUrl,
			webauth: server.expectedWebauth,
		});
		expect(result).toEqual({
			ok: true,
			status: 200,
			body: '{"table":{"table_name":"modules","exists":true}}',
		});
	});

	it("fails when both HEAD and legacy fallback fail", async () => {
		server = await startPhantomBotLikeHttpServer({
			headDbQueryStatus: 404,
			legacyDbQueryStatus: 500,
			legacyDbQueryBody: "legacy probe failed",
		});
		const result = await testPhantomBotConnection({
			baseUrl: server.baseUrl,
			webauth: server.expectedWebauth,
		});
		expect(result).toEqual({ ok: false, status: 500, body: "legacy probe failed" });
	});

	it("testPhantomBotConnection fails when webauth does not match", async () => {
		server = await startPhantomBotLikeHttpServer({});
		const result = await testPhantomBotConnection({
			baseUrl: server.baseUrl,
			webauth: "wrong-token",
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe(401);
	});

	it("sendPhantomCommand sends PhantomBot headers and reads the response body", async () => {
		server = await startPhantomBotLikeHttpServer({ dbQueryBody: "queued" });
		const result = await sendPhantomCommand({
			baseUrl: server.baseUrl,
			webauth: server.expectedWebauth,
			phantomUser: "streamer",
			message: "!points",
		});
		expect(result).toEqual({ ok: true, status: 200, body: "queued" });
		expect(server.getLastDbQueryHeaders()).toEqual({
			user: "streamer",
			message: "!points",
			webauth: server.expectedWebauth,
		});
	});

	it("sendPhantomCommand strips trailing slash on baseUrl before calling /dbquery", async () => {
		server = await startPhantomBotLikeHttpServer({});
		const result = await sendPhantomCommand({
			baseUrl: `${server.baseUrl}/`,
			webauth: server.expectedWebauth,
			phantomUser: "u",
			message: "!x",
		});
		expect(result.ok).toBe(true);
	});
});

describe("phantomBot (integration, HTTPS self-signed + allowInsecureTls)", () => {
	let server: Awaited<ReturnType<typeof startPhantomBotLikeHttpsServer>>;

	afterEach(async () => {
		if (server) await server.close();
	});

	it("rejects TLS by default (no allowInsecureTls) so the probe throws", async () => {
		server = await startPhantomBotLikeHttpsServer({});
		await expect(
			testPhantomBotConnection({
				baseUrl: server.baseUrl,
				webauth: server.expectedWebauth,
			}),
		).rejects.toSatisfy((err: unknown) => {
			if (!(err instanceof Error)) return false;
			const fromCause = err.cause instanceof Error ? err.cause.message : String(err.cause ?? "");
			const chain = `${err.message} ${fromCause}`;
			return /CERT|certificate|TLS|SSL|self|signed|verify|UNABLE|authority|unknown|fetch failed/i.test(chain);
		});
	});

	it("testPhantomBotConnection succeeds when allowInsecureTls is true", async () => {
		server = await startPhantomBotLikeHttpsServer({});
		const result = await testPhantomBotConnection({
			baseUrl: server.baseUrl,
			webauth: server.expectedWebauth,
			allowInsecureTls: true,
		});
		expect(result).toEqual({ ok: true, status: 405, body: "" });
	});

	it("sendPhantomCommand succeeds over HTTPS with allowInsecureTls", async () => {
		server = await startPhantomBotLikeHttpsServer({ dbQueryBody: "tls-ok" });
		const result = await sendPhantomCommand({
			baseUrl: server.baseUrl,
			webauth: server.expectedWebauth,
			phantomUser: "u",
			message: "!cmd",
			allowInsecureTls: true,
		});
		expect(result).toEqual({ ok: true, status: 200, body: "tls-ok" });
		expect(server.getLastDbQueryHeaders()).toMatchObject({
			user: "u",
			message: "!cmd",
			webauth: server.expectedWebauth,
		});
	});
});

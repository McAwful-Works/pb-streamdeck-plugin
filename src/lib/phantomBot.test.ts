import { Agent } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendPhantomCommand, testPhantomBotConnection } from "./phantomBot";

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));

vi.mock("undici", async (importOriginal) => {
	const undici = await importOriginal<typeof import("undici")>();
	return {
		...undici,
		fetch: mockFetch,
	};
});

describe("sendPhantomCommand", () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
	});

	it("PUTs to /dbquery with trailing slash stripped from base URL", async () => {
		await sendPhantomCommand({
			baseUrl: "https://bot.example:25000/",
			webauth: "token",
			phantomUser: "channel",
			message: "!ping",
		});

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0]!;
		expect(String(url)).toBe("https://bot.example:25000/dbquery");
		expect(init).toMatchObject({
			method: "PUT",
			headers: {
				user: "channel",
				message: "!ping",
				webauth: "token",
			},
		});
	});

	it("returns ok, status, and body text", async () => {
		mockFetch.mockResolvedValue(new Response("not ok", { status: 401, statusText: "Unauthorized" }));

		const result = await sendPhantomCommand({
			baseUrl: "http://127.0.0.1:25000",
			webauth: "w",
			phantomUser: "u",
			message: "!x",
		});

		expect(result).toEqual({ ok: false, status: 401, body: "not ok" });
	});

	it("passes a dispatcher when allowInsecureTls is true", async () => {
		await sendPhantomCommand({
			baseUrl: "https://selfsigned.local",
			webauth: "w",
			phantomUser: "u",
			message: "!x",
			allowInsecureTls: true,
		});

		const init = mockFetch.mock.calls[0]![1] as RequestInit;
		expect(init.dispatcher).toBeDefined();
	});

	it("does not set dispatcher when allowInsecureTls is false", async () => {
		await sendPhantomCommand({
			baseUrl: "https://ok.example",
			webauth: "w",
			phantomUser: "u",
			message: "!x",
			allowInsecureTls: false,
		});
		expect((mockFetch.mock.calls[0]![1] as RequestInit).dispatcher).toBeUndefined();
	});

	it("does not set dispatcher when allowInsecureTls is omitted", async () => {
		await sendPhantomCommand({
			baseUrl: "https://ok.example",
			webauth: "w",
			phantomUser: "u",
			message: "!x",
		});
		expect((mockFetch.mock.calls[0]![1] as RequestInit).dispatcher).toBeUndefined();
	});
});

describe("testPhantomBotConnection", () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockImplementation(() => Promise.resolve(new Response("", { status: 405 })));
	});

	it("HEADs /dbquery with webauth header and treats 405 as success", async () => {
		const result = await testPhantomBotConnection({
			baseUrl: "https://host/",
			webauth: "abc",
		});

		expect(result).toEqual({ ok: true, status: 405, body: "" });
		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0]!;
		expect(String(url)).toBe("https://host/dbquery");
		expect(init).toMatchObject({
			method: "HEAD",
			headers: { webauth: "abc" },
		});
		expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
	});

	it("falls back to legacy GET /dbquery?table=modules&tableExists for older bots", async () => {
		mockFetch
			.mockResolvedValueOnce(new Response("", { status: 404 }))
			.mockResolvedValueOnce(new Response('{"table":{"exists":true}}', { status: 200 }));

		const result = await testPhantomBotConnection({
			baseUrl: "https://host/",
			webauth: "abc",
		});

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(String(mockFetch.mock.calls[1]![0])).toBe("https://host/dbquery?table=modules&tableExists");
		expect((mockFetch.mock.calls[1]![1] as RequestInit).method).toBe("GET");
		expect(result).toEqual({ ok: true, status: 200, body: '{"table":{"exists":true}}' });
	});

	it("does not fallback when HEAD fails auth", async () => {
		mockFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

		const result = await testPhantomBotConnection({
			baseUrl: "https://host/",
			webauth: "bad",
		});

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ ok: false, status: 401, body: "unauthorized" });
	});

	it("aborts a hung probe after the per-probe timeout and propagates AbortError", async () => {
		vi.useFakeTimers();
		try {
			// Real Undici rejects an aborted request; it never resolves with a synthetic 408 status.
			mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						const err = new Error("This operation was aborted");
						err.name = "AbortError";
						reject(err);
					});
				});
			});

			const p = testPhantomBotConnection({ baseUrl: "http://localhost:1", webauth: "x" });
			const rejection = expect(p).rejects.toMatchObject({ name: "AbortError" });
			await vi.advanceTimersByTimeAsync(6_000);
			await rejection;

			// A host that never answered the first probe must not be probed a second time.
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect((mockFetch.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
			await vi.runOnlyPendingTimersAsync();
		} finally {
			vi.useRealTimers();
		}
	});

	it("gives the legacy fallback its own abort budget after a slow HEAD", async () => {
		vi.useFakeTimers();
		try {
			// HEAD answers just inside its own budget; the fallback must still get a full, fresh one
			// rather than whatever the HEAD probe left over.
			const respondAfter = (ms: number, res: () => Response) => (_url: string, init?: RequestInit) =>
				new Promise<Response>((resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
					setTimeout(() => resolve(res()), ms);
				});

			mockFetch
				.mockImplementationOnce(respondAfter(5_900, () => new Response("", { status: 404 })))
				.mockImplementationOnce(respondAfter(5_900, () => new Response("{}", { status: 200 })));

			const p = testPhantomBotConnection({ baseUrl: "http://slow.local", webauth: "x" });
			await vi.advanceTimersByTimeAsync(12_000);

			expect(await p).toEqual({ ok: true, status: 200, body: "{}" });
			expect(mockFetch).toHaveBeenCalledTimes(2);

			// Each probe must carry its own controller; sharing one is what starved the fallback.
			const headSignal = (mockFetch.mock.calls[0]![1] as RequestInit).signal;
			const legacySignal = (mockFetch.mock.calls[1]![1] as RequestInit).signal;
			expect(legacySignal).not.toBe(headSignal);
			expect(headSignal?.aborted).toBe(false);
			expect(legacySignal?.aborted).toBe(false);
			await vi.runOnlyPendingTimersAsync();
		} finally {
			vi.useRealTimers();
		}
	});

	it("clears the timeout when the request finishes", async () => {
		vi.useFakeTimers();
		try {
			const clearSpy = vi.spyOn(globalThis, "clearTimeout");
			mockFetch.mockImplementation(() => Promise.resolve(new Response("", { status: 405 })));

			await testPhantomBotConnection({ baseUrl: "http://x", webauth: "y" });

			expect(clearSpy).toHaveBeenCalled();
			clearSpy.mockRestore();
			await vi.runOnlyPendingTimersAsync();
		} finally {
			vi.useRealTimers();
		}
	});

	it("passes dispatcher when allowInsecureTls is true", async () => {
		await testPhantomBotConnection({
			baseUrl: "https://x",
			webauth: "w",
			allowInsecureTls: true,
		});
		const init = mockFetch.mock.calls[0]![1] as RequestInit;
		expect(init.dispatcher).toBeDefined();
	});

	it("reuses one insecure-TLS agent across both probes and closes it", async () => {
		const closeSpy = vi.spyOn(Agent.prototype, "close");
		try {
			mockFetch
				.mockResolvedValueOnce(new Response("", { status: 404 }))
				.mockResolvedValueOnce(new Response("{}", { status: 200 }));

			await testPhantomBotConnection({ baseUrl: "https://x", webauth: "w", allowInsecureTls: true });

			expect(mockFetch).toHaveBeenCalledTimes(2);
			// One pooled agent for the whole check, not a fresh one per probe.
			const headDispatcher = (mockFetch.mock.calls[0]![1] as RequestInit).dispatcher;
			const legacyDispatcher = (mockFetch.mock.calls[1]![1] as RequestInit).dispatcher;
			expect(headDispatcher).toBeDefined();
			expect(legacyDispatcher).toBe(headDispatcher);
			expect(closeSpy).toHaveBeenCalled();
		} finally {
			closeSpy.mockRestore();
		}
	});

	it("closes the insecure-TLS agent even when a probe throws", async () => {
		const closeSpy = vi.spyOn(Agent.prototype, "close");
		try {
			mockFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

			await expect(
				testPhantomBotConnection({ baseUrl: "https://x", webauth: "w", allowInsecureTls: true }),
			).rejects.toThrow("connect ECONNREFUSED");
			expect(closeSpy).toHaveBeenCalled();
		} finally {
			closeSpy.mockRestore();
		}
	});

	it("does not create an agent when allowInsecureTls is omitted", async () => {
		const closeSpy = vi.spyOn(Agent.prototype, "close");
		try {
			await testPhantomBotConnection({ baseUrl: "https://x", webauth: "w" });
			expect((mockFetch.mock.calls[0]![1] as RequestInit).dispatcher).toBeUndefined();
			expect(closeSpy).not.toHaveBeenCalled();
		} finally {
			closeSpy.mockRestore();
		}
	});
});

import { describe, expect, it } from "vitest";
import { isPublicHost, isPublicHttpsUrl, publicFetch, readCapped, UnsafeUrlError } from "../src/urlsafety.js";
import { fakeNet } from "./helpers/net.js";

describe("public hosts", () => {
  it.each(["example.com", "shop.example.co.uk", "8.8.8.8", "2606:4700::1111"])("accepts %s", (host) => {
    expect(isPublicHost(host)).toBe(true);
  });

  it.each([
    "localhost",
    "intranet",
    "db.internal",
    "printer.local",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "[::1]",
    "::ffff:10.0.0.1",
    "fd00::1",
    "fe80::1",
    "64:ff9b::a00:1",
  ])("refuses %s", (host) => {
    expect(isPublicHost(host)).toBe(false);
  });

  it("accepts only https, with no sign-in part", () => {
    expect(isPublicHttpsUrl("https://example.com/a")).toBe(true);
    expect(isPublicHttpsUrl("http://example.com/a")).toBe(false);
    expect(isPublicHttpsUrl("https://user:pw@example.com/")).toBe(false);
    expect(isPublicHttpsUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicHttpsUrl("https://example.com:8443/a")).toBe(false);
    expect(isPublicHttpsUrl("https://example.com:443/a")).toBe(true);
    expect(isPublicHttpsUrl("not a url")).toBe(false);
  });
});

describe("publicFetch", () => {
  it("refuses an http address before any request", async () => {
    const net = fakeNet({});
    await expect(publicFetch("http://example.com/", "The page", net)).rejects.toThrow(UnsafeUrlError);
    expect(net.requested).toEqual([]);
  });

  it("refuses a private address before any request", async () => {
    const net = fakeNet({});
    await expect(publicFetch("https://10.0.0.5/", "The page", net)).rejects.toThrow(/https address on a public host/);
    expect(net.requested).toEqual([]);
  });

  it("refuses a public name that resolves to a private address before any request", async () => {
    const net = fakeNet({}, { "sneaky.example.com": ["93.184.216.34", "169.254.169.254"] });
    await expect(publicFetch("https://sneaky.example.com/", "The page", net)).rejects.toThrow(/does not fetch/);
    expect(net.requested).toEqual([]);
  });

  it("stops at a redirect to a private address and never requests it", async () => {
    const net = fakeNet({ "https://example.com/": { status: 302, headers: { location: "https://192.168.0.1/admin" } } });
    await expect(publicFetch("https://example.com/", "The page", net)).rejects.toThrow(/redirected to an address/);
    expect(net.requested).toEqual(["https://example.com/"]);
  });

  it("stops at a redirect to plain http", async () => {
    const net = fakeNet({ "https://example.com/": { status: 301, headers: { location: "http://example.com/" } } });
    await expect(publicFetch("https://example.com/", "The page", net)).rejects.toThrow(UnsafeUrlError);
    expect(net.requested).toHaveLength(1);
  });

  it("follows a redirect to a public https address", async () => {
    const net = fakeNet({
      "https://example.com/": { status: 302, headers: { location: "/home" } },
      "https://example.com/home": { body: "hello" },
    });
    const { url, response } = await publicFetch("https://example.com/", "The page", net);
    expect(url).toBe("https://example.com/home");
    expect(await response.text()).toBe("hello");
  });

  it("gives up on a redirect loop", async () => {
    const net = fakeNet({ "https://example.com/": { status: 302, headers: { location: "https://example.com/" } } });
    await expect(publicFetch("https://example.com/", "The page", net)).rejects.toThrow(/too many times/);
  });
});

describe("readCapped", () => {
  it("reads a body under the limit and refuses one over it", async () => {
    expect(new TextDecoder().decode(await readCapped(new Response("abc"), "The page", 10))).toBe("abc");
    await expect(readCapped(new Response("x".repeat(50)), "The page", 10)).rejects.toThrow(/larger than/);
  });
});

import { describe, expect, it } from "vitest";
import { isPublicHost, isPublicHttpsUrl, publicFetch, publicOnlyLookup, readCapped, UnsafeUrlError } from "../src/urlsafety.js";
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

describe("the lookup a connection uses", () => {
  type Resolve = Parameters<typeof publicOnlyLookup>[0];
  const answers = (...addresses: string[]) =>
    ((_host: string, _options: unknown, done: (error: Error | null, list: { address: string; family: number }[]) => void) =>
      done(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })))) as unknown as Resolve;
  const connect = (resolve: Resolve, all: boolean) =>
    new Promise<{ error: Error | null; address: unknown }>((done) =>
      publicOnlyLookup(resolve)("rebind.example", { all }, (error, address) => done({ error, address })),
    );

  it("gives a public address to the socket", async () => {
    expect(await connect(answers("93.184.216.34"), false)).toEqual({ error: null, address: "93.184.216.34" });
    expect(await connect(answers("93.184.216.34", "2606:2800:220:1::1"), true)).toMatchObject({ error: null, address: [{ address: "93.184.216.34" }, { address: "2606:2800:220:1::1" }] });
  });

  it("refuses a name whose answer at the moment of the connection is private, even among public ones", async () => {
    for (const list of [["127.0.0.1"], ["10.0.0.5"], ["169.254.169.254"], ["93.184.216.34", "192.168.1.1"], ["::1"], []]) {
      expect((await connect(answers(...list), true)).error?.message).toMatch(/does not fetch/);
    }
  });
});

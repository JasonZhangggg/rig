import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudClient, serverDownText, unreachableText } from "../src";

const client = () => new CloudClient({ base: "/api" });

describe("CloudClient when the server is in trouble", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says the server isn't answering instead of passing on a bare 500", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500, statusText: "Internal Server Error" }));
    await expect(client().account()).rejects.toThrow(serverDownText);
    await expect(client().signInEmail("a@b.co", "password1")).rejects.toThrow(serverDownText);
  });

  it("keeps the server's own words when it gives them", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: "Invalid email or password" }, { status: 401 }));
    await expect(client().signInEmail("a@b.co", "password1")).rejects.toThrow("Invalid email or password");
  });

  it("says it can't reach the server when the request never got there", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    await expect(client().machines()).rejects.toThrow(unreachableText);
  });

  it("treats a signed-out account as no account, not an error", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: "Sign in first." }, { status: 401 }));
    await expect(client().account()).resolves.toBeNull();
  });
});

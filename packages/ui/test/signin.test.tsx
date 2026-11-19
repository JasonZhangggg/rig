import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RigClient } from "@rig/core";
import { SignIn } from "../src/pages/SignIn";

const jo = { id: "u1", name: "Jo", email: "jo@example.com" };

describe("Sign-in screen", () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("signs in with email and password even when the art can't draw", async () => {
    const signInEmail = vi.fn(async () => jo);
    const onDone = vi.fn();
    render(<SignIn client={{ kind: "web", signInEmail } as unknown as RigClient} onDone={onDone} />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Rig")).toBeTruthy();
    expect(screen.queryByText("Know what's inside your PC, what's wrong with it and what to do next.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jo@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(jo));
    expect(signInEmail).toHaveBeenCalledWith("jo@example.com", "correct horse", undefined);
    expect(screen.getByRole("link", { name: "Try the demo" }).getAttribute("href")).toBe("/app/?demo");
  });

  it("makes an account with the name given", async () => {
    const signInEmail = vi.fn(async () => jo);
    render(<SignIn client={{ kind: "web", signInEmail } as unknown as RigClient} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Create one" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jo" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jo@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(signInEmail).toHaveBeenCalledWith("jo@example.com", "correct horse", { name: "Jo" }));
  });

  it("shows the code in the desktop app and offers no demo there", async () => {
    const done = new Promise<never>(() => {});
    const signInWithBrowser = vi.fn(async () => ({ code: "W4XKLL2V", url: "rig.app/device", done }));
    const onSkip = vi.fn();
    render(<SignIn client={{ kind: "desktop", signInWithBrowser } as unknown as RigClient} onDone={() => {}} onSkip={onSkip} />);
    expect(screen.queryByRole("link", { name: "Try the demo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with your browser" }));
    expect((await screen.findByLabelText("Sign-in code")).textContent).toBe("W4XKLL2V");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("shows one quiet line beside the art", () => {
    const client = { kind: "web", signInEmail: vi.fn() } as unknown as RigClient;
    render(<SignIn client={client} onDone={() => {}} />);
    expect(screen.getByText("See inside your PC.")).toBeTruthy();
  });
});

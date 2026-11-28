import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type RigClient } from "@rig/core";
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

  const fill = (email: string, password: string) => {
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  };

  it("says in plain words when the email and password don't match, or after too many tries", async () => {
    const signInEmail = vi.fn()
      .mockRejectedValueOnce(new ApiError(401, "Invalid email or password"))
      .mockRejectedValueOnce(new ApiError(429, "Too many requests. Please try again later."));
    render(<SignIn client={{ kind: "web", signInEmail } as unknown as RigClient} onDone={() => {}} />);
    fill("jo@example.com", "wrong horse");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That email and password don't match an account. Check them and try again.");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Too many tries in a row. Wait a minute, then try again."));
  });

  it("signs in when someone creates an account they already have, with the right password", async () => {
    const signInEmail = vi.fn(async (_e: string, _p: string, create?: { name: string }) => {
      if (create) throw new ApiError(422, "User already exists. Use another email.");
      return jo;
    });
    const onDone = vi.fn();
    render(<SignIn client={{ kind: "web", signInEmail } as unknown as RigClient} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Create one" }));
    fill("jo@example.com", "correct horse");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(jo));
    expect(signInEmail).toHaveBeenLastCalledWith("jo@example.com", "correct horse", undefined);
  });

  it("turns to Sign in when the account exists and the password is another one", async () => {
    const signInEmail = vi.fn(async (_e: string, _p: string, create?: { name: string }) => {
      throw create ? new ApiError(422, "User already exists. Use another email.") : new ApiError(401, "Invalid email or password");
    });
    const onDone = vi.fn();
    render(<SignIn client={{ kind: "web", signInEmail } as unknown as RigClient} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Create one" }));
    fill("jo@example.com", "new horse");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toBe("There's already an account for jo@example.com. Sign in with its password.");
    // A wrong password never signs anyone in. Saying the account exists adds nothing: creating it already says so.
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("jo@example.com");
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

  it("shows only the logo and the art beside the form, with no headline", () => {
    const client = { kind: "web", signInEmail: vi.fn() } as unknown as RigClient;
    render(<SignIn client={client} onDone={() => {}} />);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Sign in"]);
    expect(screen.queryByText("See inside your PC.")).toBeNull();
    expect(screen.queryByText("Live temperatures for every part, problems in plain words, and fixes you approve.")).toBeNull();
  });
});

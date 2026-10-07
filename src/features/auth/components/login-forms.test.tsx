import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthFormState } from "@/features/auth/types";

const actions = vi.hoisted(() => ({
  signIn:
    vi.fn<(prev: unknown, formData: FormData) => Promise<AuthFormState>>(),
  signUp:
    vi.fn<(prev: unknown, formData: FormData) => Promise<AuthFormState>>(),
}));
vi.mock("@/features/auth/server/actions", () => actions);

const { LoginForms } = await import("./login-forms");

beforeEach(() => {
  actions.signIn.mockReset();
  actions.signUp.mockReset();
});

function signInWith(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
}

test("offers sign in and account creation", () => {
  render(<LoginForms next="/dashboard" />);

  expect(screen.getByRole("tab", { name: "Sign in" })).toBeInTheDocument();
  expect(
    screen.getByRole("tab", { name: "Create account" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeInTheDocument();
});

test("shows a returned field error next to its input and keeps the email", async () => {
  actions.signIn.mockResolvedValue({
    ok: false,
    message: "Please check the highlighted fields.",
    fieldErrors: { password: ["Enter your password."] },
    email: "alice@example.com",
  });
  render(<LoginForms next="/courses" />);

  signInWith("alice@example.com", "secret");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByText("Enter your password.")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("Email")).toHaveValue("alice@example.com");

  const formData = actions.signIn.mock.calls[0]![1];
  expect(formData.get("intent")).toBe("password");
  expect(formData.get("next")).toBe("/courses");
});

test("shows an auth error as an alert", async () => {
  actions.signIn.mockResolvedValue({
    ok: false,
    message: "Email or password is incorrect.",
    email: "alice@example.com",
  });
  render(<LoginForms next="/dashboard" />);

  signInWith("alice@example.com", "wrong");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Email or password is incorrect.",
  );
});

test("confirms a sent sign-in link and lets the user start over", async () => {
  actions.signIn.mockResolvedValue({
    ok: true,
    data: undefined,
    email: "alice@example.com",
  });
  render(<LoginForms next="/dashboard" />);

  // Browsers skip the password's `required` check for this button
  // (formnovalidate); jsdom does not, so the test fills it in.
  signInWith("alice@example.com", "unused");
  fireEvent.click(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  );

  expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
  expect(actions.signIn.mock.calls[0]![1].get("intent")).toBe("link");

  fireEvent.click(
    screen.getByRole("button", { name: "Use a different email" }),
  );
  expect(screen.getByLabelText("Email")).toHaveValue("");
});

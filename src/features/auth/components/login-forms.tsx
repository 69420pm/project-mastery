import {
  signInWithMagicLink,
  signInWithPassword,
  signUp,
} from "@/features/auth/server/actions";

// Placeholder UI: plain form elements until the design system lands.
const fieldClass = "rounded border px-2 py-1";
const buttonClass = "rounded border px-3 py-1 font-medium";

type LoginFormsProps = {
  /** Same-origin path to return to after signing in. */
  next: string;
};

/** Sign in with a password or an email link, or create an account. */
export function LoginForms({ next }: LoginFormsProps) {
  return (
    <>
      <form action={signInWithPassword} className="flex flex-col gap-2">
        <h2 className="font-medium">With email and password</h2>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="sign-in-email">Email</label>
        <input
          id="sign-in-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={fieldClass}
        />
        <label htmlFor="sign-in-password">Password</label>
        <input
          id="sign-in-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={fieldClass}
        />
        <button type="submit" className={buttonClass}>
          Sign in
        </button>
      </form>

      <form action={signInWithMagicLink} className="flex flex-col gap-2">
        <h2 className="font-medium">With a link by email</h2>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="magic-link-email">Email</label>
        <input
          id="magic-link-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={fieldClass}
        />
        <button type="submit" className={buttonClass}>
          Email me a sign-in link
        </button>
      </form>

      <form action={signUp} className="flex flex-col gap-2">
        <h2 className="font-medium">Create an account</h2>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="sign-up-email">Email</label>
        <input
          id="sign-up-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={fieldClass}
        />
        <label htmlFor="sign-up-password">
          Password (at least 8 characters)
        </label>
        <input
          id="sign-up-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
          className={fieldClass}
        />
        <button type="submit" className={buttonClass}>
          Create account
        </button>
      </form>
    </>
  );
}

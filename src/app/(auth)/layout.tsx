import Link from "next/link";
import { Logo } from "@/components/logo";

/** Centers the sign-in pages below the product's logo. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 bg-muted/40 px-4 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <Link
          href="/"
          className="rounded-md text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo />
        </Link>
        <p className="text-sm text-balance text-muted-foreground">
          Your AI tutor for exam preparation.
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-4">{children}</div>
    </main>
  );
}

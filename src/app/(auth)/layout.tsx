import Link from "next/link";

/** Centers the sign-in pages below the product name. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Project Mastery
      </Link>
      <div className="flex w-full max-w-sm flex-col gap-4">{children}</div>
    </main>
  );
}

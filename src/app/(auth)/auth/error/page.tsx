import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Sign-in link problem",
};

export default function AuthErrorPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>This link did not work</h1>
        </CardTitle>
        <CardDescription>
          The sign-in or confirmation link is invalid or has expired. Links work
          once and only for a limited time.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

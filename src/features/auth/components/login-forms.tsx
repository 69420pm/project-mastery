"use client";

import { useState } from "react";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { SignUpForm } from "@/features/auth/components/sign-up-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type LoginFormsProps = {
  /** Same-origin path to return to after signing in. */
  next: string;
};

/** Sign in with a password or an email link, or create an account. */
export function LoginForms({ next }: LoginFormsProps) {
  const [tab, setTab] = useState("sign-in");
  // Bumping the key remounts the forms, which clears their action state.
  const [formKey, setFormKey] = useState(0);
  const reset = () => setFormKey((key) => key + 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome</CardTitle>
        <CardDescription>
          Sign in or create an account to continue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab} className="gap-6">
          <TabsList className="w-full">
            <TabsTrigger value="sign-in">Sign in</TabsTrigger>
            <TabsTrigger value="sign-up">Create account</TabsTrigger>
          </TabsList>
          <TabsContent value="sign-in">
            <SignInForm key={formKey} next={next} onReset={reset} />
          </TabsContent>
          <TabsContent value="sign-up">
            <SignUpForm key={formKey} next={next} onReset={reset} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

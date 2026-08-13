import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = {
  title: "log in",
};

export default function LoginPage() {
  return (
    <AuthShell
      title="welcome back"
      description="log in to your account to manage your domains."
      footer={
        <>
          no account yet?{" "}
          <Link
            href="/register"
            className="font-medium text-primary hover:underline"
          >
            sign up
          </Link>
        </>
      }
    >
      <AuthForm mode="login" />
    </AuthShell>
  );
}

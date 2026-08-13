import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = {
  title: "create account",
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="create your account"
      description="sign up to register, transfer, and manage your domains."
      footer={
        <>
          already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            log in
          </Link>
        </>
      }
    >
      <AuthForm mode="register" />
    </AuthShell>
  );
}

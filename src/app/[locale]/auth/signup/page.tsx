"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mail, Lock, User } from "lucide-react";

export default function SignupPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;
    const displayName = form.get("displayName") as string;

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName, locale }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Signup failed");
        return;
      }
      setSuccess(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>{t("signupSuccessTitle")}</CardTitle>
            <CardDescription>{t("signupSuccessDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <Mail className="w-4 h-4" />
              <AlertDescription>{t("signupSuccessMessage")}</AlertDescription>
            </Alert>
            <Button className="w-full mt-4" asChild>
              <Link href="/auth/signin">{t("goToSignin")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>{t("signupTitle")}</CardTitle>
          <CardDescription>{t("signupDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="displayName">{t("displayName")}</Label>
              <div className="relative">
                <User className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="displayName" name="displayName" type="text" className="ps-9" placeholder={t("displayNamePlaceholder")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <div className="relative">
                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="email" name="email" type="email" required className="ps-9" placeholder="you@example.com" dir="ltr" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <div className="relative">
                <Lock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="password" name="password" type="password" required minLength={8} className="ps-9" dir="ltr" />
              </div>
              <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("signupButton")}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-4">
            {t("haveAccount")}{" "}
            <Link href="/auth/signin" className="text-primary hover:underline">
              {t("signinLink")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

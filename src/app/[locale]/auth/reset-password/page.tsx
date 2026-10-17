"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    // Always show success message (enumeration defense).
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>{t("resetTitle")}</CardTitle>
          <CardDescription>{t("resetDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <Alert className="border-green-500/50">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <AlertDescription>{t("resetSentMessage")}</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("email")}</Label>
                <div className="relative">
                  <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="email" name="email" type="email" required className="ps-9" dir="ltr" placeholder="you@example.com" />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("resetButton")}
              </Button>
            </form>
          )}
          <p className="text-sm text-muted-foreground text-center mt-4">
            <Link href="/auth/signin" className="hover:underline">{t("backToSignin")}</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

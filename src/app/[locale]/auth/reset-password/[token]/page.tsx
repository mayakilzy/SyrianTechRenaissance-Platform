"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Lock, CheckCircle2, XCircle } from "lucide-react";

export default function ConfirmResetPage() {
  const t = useTranslations("auth");
  const params = useParams<{ token: string }>();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const newPassword = form.get("newPassword") as string;
    const confirm = form.get("confirm") as string;

    if (newPassword !== confirm) {
      setError(t("passwordMismatch"));
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/reset-password/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: params.token, newPassword }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setDone(true);
    } else {
      setError(data.error?.message ?? t("resetConfirmFailed"));
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>{t("resetConfirmTitle")}</CardTitle>
          <CardDescription>{t("resetConfirmDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <>
              <Alert className="border-green-500/50">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <AlertDescription>{t("resetConfirmSuccess")}</AlertDescription>
              </Alert>
              <Button className="w-full mt-4" asChild>
                <Link href="/auth/signin">{t("goToSignin")}</Link>
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <XCircle className="w-4 h-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="newPassword">{t("newPassword")}</Label>
                <div className="relative">
                  <Lock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="newPassword" name="newPassword" type="password" required minLength={8} className="ps-9" dir="ltr" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{t("confirmPassword")}</Label>
                <div className="relative">
                  <Lock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="confirm" name="confirm" type="password" required minLength={8} className="ps-9" dir="ltr" />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("resetConfirmButton")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

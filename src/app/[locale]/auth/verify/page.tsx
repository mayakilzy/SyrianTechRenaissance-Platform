"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

function VerifyContent() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      // Use a microtask to avoid setState-in-effect warning
      Promise.resolve().then(() => {
        setStatus("error");
        setMessage(t("verifyNoToken"));
      });
      return;
    }
    let cancelled = false;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (cancelled) return;
        const data = await res.json();
        if (res.ok && data.ok) {
          setStatus("success");
          setMessage(data.data.message);
        } else {
          setStatus("error");
          setMessage(data.error?.message ?? t("verifyFailed"));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        setMessage(t("verifyFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>{t("verifyTitle")}</CardTitle>
          <CardDescription>{t("verifyDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {status === "loading" && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}
          {status === "success" && (
            <Alert className="border-green-500/50">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          {status === "error" && (
            <Alert variant="destructive">
              <XCircle className="w-4 h-4" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          {status === "success" && (
            <Button className="w-full mt-4" asChild>
              <Link href="/auth/signin">{t("goToSignin")}</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
      <VerifyContent />
    </Suspense>
  );
}

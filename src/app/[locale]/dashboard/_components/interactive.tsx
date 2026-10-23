"use client";

import { useState, useCallback } from "react";
import { Plus, Search, Bookmark } from "lucide-react";
import Link from "next/link";
import type { Locale } from "@/i18n/config";

// ─── Hero buttons (New Project + Explore) ────────────────────────────────────
export function HeroButtons({
  newProjectLabel,
  exploreLabel,
  locale,
  newProjectToast,
}: {
  newProjectLabel: string;
  exploreLabel: string;
  locale: Locale;
  newProjectToast: string;
}) {
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <>
      <div className="str-hero-buttons">
        <button
          className="str-btn primary"
          onClick={() => showToast(newProjectToast)}
        >
          <Plus />
          <span>{newProjectLabel}</span>
        </button>
        <Link
          href={`/${locale === "ar" ? "" : "en/"}opportunities`}
          className="str-btn outline"
        >
          <Search />
          <span>{exploreLabel}</span>
        </Link>
      </div>
      {toast && (
        <div className="str-toast show" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </>
  );
}

// ─── Save button (for opportunities) ─────────────────────────────────────────
export function SaveButton({
  saveLabel,
  savedLabel,
}: {
  saveLabel: string;
  savedLabel: string;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <button
      className={`str-save-btn ${saved ? "saved" : ""}`}
      aria-label={saveLabel}
      onClick={() => setSaved(!saved)}
    >
      <Bookmark />
    </button>
  );
}

// ─── Connect button (for engineers) ─────────────────────────────────────────
export function ConnectButton({
  connectLabel,
  toastMsg,
}: {
  connectLabel: string;
  toastMsg: string;
}) {
  const [toast, setToast] = useState<string | null>(null);
  return (
    <>
      <button
        className="str-connect"
        onClick={() => {
          setToast(toastMsg);
          setTimeout(() => setToast(null), 3500);
        }}
      >
        {connectLabel}
      </button>
      {toast && (
        <div className="str-toast show" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </>
  );
}

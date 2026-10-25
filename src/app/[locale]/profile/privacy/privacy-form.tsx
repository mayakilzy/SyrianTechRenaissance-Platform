"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

interface VisibilityData {
  showContact: boolean;
  showLocation: boolean;
  showSkills: boolean;
  showPortfolio: boolean;
  showAvailability: boolean;
}

export function PrivacySettingsForm({
  initialVisibility,
  locale,
}: {
  initialVisibility: VisibilityData;
  locale: string;
}) {
  const t = useTranslations("profile");
  const router = useRouter();
  const isAr = locale === "ar";
  const [visibility, setVisibility] = useState<VisibilityData>(initialVisibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const toggle = (field: keyof VisibilityData) => {
    setVisibility((prev) => ({ ...prev, [field]: !prev[field] }));
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/profile/visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(visibility),
      });
      const result = await res.json();
      if (!result.ok) {
        setError(result.error?.message || (isAr ? "فشل الحفظ" : "Save failed"));
      } else {
        setSuccess(true);
      }
    } catch {
      setError(isAr ? "خطأ في الاتصال" : "Connection error");
    }
    setSaving(false);
  };

  const toggleClass = "relative w-12 h-6 rounded-full transition-colors duration-200 cursor-pointer";
  const toggleOnClass = toggleClass + " bg-[#00b86c]";
  const toggleOffClass = toggleClass + " bg-[#123958]";
  const knobClass = "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200";
  const knobOnClass = knobClass + " translate-x-6";
  const knobOffClass = knobClass + " translate-x-0.5";

  const settings = [
    { key: "showContact" as const, label: isAr ? "معلومات التواصل" : "Contact Information", desc: isAr ? "إظهار بريد التواصل للمستخدمين المسجلين" : "Show contact email to registered users" },
    { key: "showLocation" as const, label: isAr ? "الموقع" : "Location", desc: isAr ? "إظهار موقعك على ملفك العام" : "Show your location on your public profile" },
    { key: "showSkills" as const, label: isAr ? "المهارات" : "Skills", desc: isAr ? "إظهار مهاراتك على ملفك العام" : "Show your skills on your public profile" },
    { key: "showPortfolio" as const, label: isAr ? "الأعمال" : "Portfolio", desc: isAr ? "إظهار أعمالك على ملفك العام" : "Show your portfolio on your public profile" },
    { key: "showAvailability" as const, label: isAr ? "التوفر" : "Availability", desc: isAr ? "إظهار حالة التوفر على ملفك العام" : "Show your availability status on your public profile" },
  ];

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-2 text-white">{t("managePrivacy")}</h1>
      <p className="text-sm text-[#a6c5e9] mb-8">{isAr ? "تحكم في ظهور معلوماتك على ملفك العام." : "Control what is visible on your public profile."}</p>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-[#3b1212] border border-[#f60058] text-[#ff9eb5] text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 rounded-lg bg-[#0a3b1a] border border-[#00b86c] text-[#7fffe0] text-sm">
          {isAr ? "تم حفظ إعدادات الخصوصية بنجاح." : "Privacy settings saved successfully."}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {settings.map((setting) => (
          <div
            key={setting.key}
            className="flex items-center justify-between gap-4 p-4 rounded-lg bg-[#06172e] border border-[#0c345a]"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">{setting.label}</div>
              <div className="text-xs text-[#a6c5e9] mt-1">{setting.desc}</div>
            </div>
            <button
              type="button"
              onClick={() => toggle(setting.key)}
              className={visibility[setting.key] ? toggleOnClass : toggleOffClass}
              role="switch"
              aria-checked={visibility[setting.key]}
              aria-label={setting.label}
            >
              <span className={visibility[setting.key] ? knobOnClass : knobOffClass} />
            </button>
          </div>
        ))}

        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 rounded-lg font-bold text-white bg-gradient-to-r from-[#00bfff] via-[#074bff] to-[#b800ef] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {saving ? (isAr ? "جاري الحفظ..." : "Saving...") : (isAr ? "حفظ الإعدادات" : "Save Settings")}
          </button>
          <button
            type="button"
            onClick={() => router.push(isAr ? "/profile" : "/en/profile")}
            className="px-6 py-3 rounded-lg font-bold text-white border border-[#0867c9] bg-[#001c36c9] hover:bg-[#082c60] transition-colors"
          >
            {isAr ? "رجوع" : "Back"}
          </button>
        </div>
      </form>
    </div>
  );
}

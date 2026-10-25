"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

interface ProfileFormData {
  displayName: string;
  headline: string;
  bio: string;
  avatarUrl: string;
  contactEmail: string;
  location: string;
  websiteUrl: string;
  availability: string;
}

export function ProfileEditForm({
  initialData,
  locale,
}: {
  initialData: ProfileFormData;
  locale: string;
}) {
  const t = useTranslations("profile");
  const router = useRouter();
  const isAr = locale === "ar";
  const [data, setData] = useState<ProfileFormData>(initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChange = (field: keyof ProfileFormData, value: string) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!result.ok) {
        const msg = result.error?.message || (isAr ? "فشل الحفظ" : "Save failed");
        const fields = result.error?.meta || result.meta;
        if (fields && typeof fields === "object") {
          const fieldMsgs = Object.entries(fields)
            .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
            .join("; ");
          setError(`${msg} (${fieldMsgs})`);
        } else {
          setError(msg);
        }
      } else {
        setSuccess(true);
        setTimeout(() => router.push(isAr ? "/profile" : "/en/profile"), 1500);
      }
    } catch {
      setError(isAr ? "خطأ في الاتصال" : "Connection error");
    }
    setSaving(false);
  };

  const inputClass = "w-full bg-[#052553] border border-[#153d74] rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-[#49dfff] transition-colors";
  const labelClass = "block text-xs font-semibold mb-2 text-[#a8c4ed]";
  const fieldClass = "mb-5";

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-2 text-white">{t("edit")}</h1>
      <p className="text-sm text-[#a6c5e9] mb-8">{isAr ? "عدّل معلوماتك المهنية. الحقول المميزة بعلامة * إلزامية." : "Edit your professional information. Fields marked with * are required."}</p>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-[#3b1212] border border-[#f60058] text-[#ff9eb5] text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 rounded-lg bg-[#0a3b1a] border border-[#00b86c] text-[#7fffe0] text-sm">
          {isAr ? "تم الحفظ بنجاح! جاري إعادة التوجيه..." : "Saved successfully! Redirecting..."}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-0">
        <div className={fieldClass}>
          <label className={labelClass}>{isAr ? "الاسم *" : "Name *"}</label>
          <input
            type="text"
            required
            minLength={2}
            maxLength={100}
            className={inputClass}
            value={data.displayName}
            onChange={(e) => handleChange("displayName", e.target.value)}
          />
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>{isAr ? "المسمى المهني" : "Professional Headline"}</label>
          <input
            type="text"
            maxLength={120}
            className={inputClass}
            placeholder={isAr ? "مثال: مهندس برمجيات أول" : "e.g., Senior Software Engineer"}
            value={data.headline}
            onChange={(e) => handleChange("headline", e.target.value)}
          />
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>{isAr ? "نبذة عني" : "About Me"}</label>
          <textarea
            maxLength={5000}
            rows={5}
            className={inputClass + " resize-y"}
            placeholder={isAr ? "اكتب نبذة مهنية عنك..." : "Write your professional bio..."}
            value={data.bio}
            onChange={(e) => handleChange("bio", e.target.value)}
          />
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>{isAr ? "الموقع" : "Location"}</label>
          <input
            type="text"
            maxLength={200}
            className={inputClass}
            placeholder={isAr ? "مثال: إسطنبول، تركيا" : "e.g., Istanbul, Türkiye"}
            value={data.location}
            onChange={(e) => handleChange("location", e.target.value)}
          />
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>{isAr ? "التوفر" : "Availability"}</label>
          <select
            className={inputClass}
            value={data.availability}
            onChange={(e) => handleChange("availability", e.target.value)}
          >
            <option value="OPEN">{isAr ? "متاح للتعاون" : "Open to Collaboration"}</option>
            <option value="LIMITED">{isAr ? "متاح بشكل محدود" : "Limited Availability"}</option>
            <option value="CLOSED">{isAr ? "غير متاح حالياً" : "Not Available"}</option>
          </select>
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>{isAr ? "بريد التواصل" : "Contact Email"}</label>
          <input
            type="email"
            className={inputClass}
            placeholder="contact@example.com"
            value={data.contactEmail}
            onChange={(e) => handleChange("contactEmail", e.target.value)}
          />
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>{isAr ? "رابط الموقع" : "Website URL"}</label>
          <input
            type="url"
            className={inputClass}
            placeholder="https://example.com"
            value={data.websiteUrl}
            onChange={(e) => handleChange("websiteUrl", e.target.value)}
          />
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>{isAr ? "رابط الصورة" : "Avatar URL"}</label>
          <input
            type="url"
            className={inputClass}
            placeholder="https://example.com/avatar.jpg"
            value={data.avatarUrl}
            onChange={(e) => handleChange("avatarUrl", e.target.value)}
          />
        </div>

        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 rounded-lg font-bold text-white bg-gradient-to-r from-[#00bfff] via-[#074bff] to-[#b800ef] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {saving ? (isAr ? "جاري الحفظ..." : "Saving...") : (isAr ? "حفظ التغييرات" : "Save Changes")}
          </button>
          <button
            type="button"
            onClick={() => router.push(isAr ? "/profile" : "/en/profile")}
            className="px-6 py-3 rounded-lg font-bold text-white border border-[#0867c9] bg-[#001c36c9] hover:bg-[#082c60] transition-colors"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>
        </div>
      </form>
    </div>
  );
}

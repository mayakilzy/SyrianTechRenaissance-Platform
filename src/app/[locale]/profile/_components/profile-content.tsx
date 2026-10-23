/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

interface SkillData { name: string; level: number; }
interface PortfolioData { id: string; title: string; description: string; }
interface ProjectData { id: string; title: string; status: string; }
interface VisibilityData {
  showContact: boolean; showLocation: boolean; showSkills: boolean;
  showPortfolio: boolean; showAvailability: boolean;
}
interface ProfileData {
  displayName: string; headline: string; bio: string; avatarUrl: string | null;
  location: string; availability: string; isAvailable: boolean;
  completeness: number; skills: SkillData[]; portfolio: PortfolioData[];
  visibility: VisibilityData | null;
}

export function ProfileContent({
  profile,
  stats,
  myProjects,
  hasError,
  locale,
}: {
  profile: ProfileData | null;
  stats: { completedProjects: number; contributions: number; skills: number; connections: number | null; mentorshipHours: number | null; completedTasks: number | null; };
  myProjects: ProjectData[];
  hasError: boolean;
  locale: string;
}) {
  const t = useTranslations("profile");
  const isAr = locale === "ar";
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Profile not found / error state
  if (hasError || !profile) {
    return (
      <section className="hero">
        <div className="hero-backdrop" aria-hidden="true" />
        <div className="profile-identity" style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "24px" }}>
          <div className="avatar-wrap" style={{ width: "90px", height: "90px" }}>
            <div className="avatar" style={{ display: "grid", placeItems: "center", background: "#062747", color: "#5da8ff", fontSize: "40px" }}>?</div>
          </div>
          <h1 style={{ fontSize: "18px" }}>{isAr ? "لم يتم إنشاء ملف بعد" : "Profile not created yet"}</h1>
          <p style={{ fontSize: "12px", color: "#a6c5e9", textAlign: "center", maxWidth: "300px" }}>
            {isAr ? "أنشئ ملفك المهني للبدء في عرض مهاراتك وخبراتك للمجتمع." : "Create your professional profile to start showcasing your skills to the community."}
          </p>
          <Link href={isAr ? "/proposals/new" : "/en/proposals/new"} className="gradient-button">
            {isAr ? "إنشاء الملف المهني" : "Create Profile"}
          </Link>
        </div>
      </section>
    );
  }

  // STR-UI-05A FIX: Represent unavailable metrics honestly — use "—" not "0"
  // A null value means the API/metric genuinely doesn't exist, not that the count is zero.
  const formatStatValue = (val: number | null): string => {
    if (val === null) return "\u2014"; // em dash for "unavailable"
    return String(val);
  };

  const statIcons = ["\u25A3", "\u2318", "\u25B1", "\u2667", "\u265C", "\u2611"];
  const statValues = [
    { value: formatStatValue(stats.completedProjects), label: t("stats.completedProjects") },
    { value: formatStatValue(stats.contributions), label: t("stats.contributions") },
    { value: formatStatValue(stats.skills), label: t("stats.skills") },
    { value: formatStatValue(stats.connections), label: t("stats.connections") },
    { value: formatStatValue(stats.mentorshipHours), label: t("stats.mentorshipHours") },
    { value: formatStatValue(stats.completedTasks), label: t("stats.completedTasks") },
  ];

  const checklist = [
    { label: t("checklist.basic"), done: profile.displayName && profile.headline },
    { label: t("checklist.skills"), done: profile.skills.length > 0 },
    { label: t("checklist.projects"), done: myProjects.length > 0 },
    { label: t("checklist.contact"), done: profile.visibility?.showContact || false },
  ];

  const projectImages = ["/profile/project-ai.webp", "/profile/project-robot.webp", "/profile/project-agri.webp"];

  return (
    <>
      {/* Hero / Profile Header */}
      <section className="hero">
        <div className="hero-backdrop" aria-hidden="true" />
        <div className="profile-identity">
          <div className="avatar-wrap">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={profile.displayName} className="avatar" />
            ) : (
              <img src="/profile/portrait.webp" alt="" className="avatar" />
            )}
            <span className="camera">{"\u25A3"}</span>
          </div>
          <div className="identity-copy">
            <h1>
              <span>{profile.displayName}</span>
              {/* No verified badge — only show if genuinely verified (not implemented yet) */}
            </h1>
            <h2>{profile.headline || (isAr ? "لم يتم تحديد المسمى المهني" : "No headline set")}</h2>
            <div className="location">
              <span>{"\u2316"}</span>
              <span>{profile.location || (isAr ? "غير محدد" : "Not specified")}</span>
              {profile.isAvailable && <span className="availability-dot"></span>}
              <span>{profile.availability}</span>
            </div>
            <div className="hero-actions">
              {/* STR-UI-05A FIX: Edit Profile button — no /profile/edit route exists.
                  The updateOwnProfile service function exists but there is no API route or UI page for it.
                  Per MASTER's directive: report as functional blocker, not operational. */}
              <button
                className="gradient-button"
                onClick={() => showToast(isAr
                  ? "تعديل الملف غير متاح حالياً — مسار التحرير قيد التطوير"
                  : "Profile editing is not available yet — editing route is under development")}
                aria-label={t("edit")}
              >
                {t("edit")}
              </button>
              {/* Public Profile button — links to talent directory (existing route) */}
              <button
                className="outline-button"
                onClick={() => { window.location.href = isAr ? "/talent" : "/en/talent"; }}
              >
                {t("public")}
              </button>
            </div>
          </div>
        </div>
        <div className="hero-quote">{t("quote")}</div>
        <div className="completeness">
          <h3>{t("completion")}</h3>
          <div className="completion-body">
            <div className="donut" style={{ background: `radial-gradient(circle at center, #06203e 55%, transparent 57%), conic-gradient(#00e0d5 0 36%, #098dff 36% ${profile.completeness}%, #173859 ${profile.completeness}%)` }}>
              {profile.completeness}%
            </div>
            <ul>
              {checklist.map((item, i) => (
                <li key={i}>
                  <span>{item.label}</span>
                  <span className="check">{item.done ? "\u25CF" : "\u25CB"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Stats — STR-UI-05A FIX: unavailable metrics show "—" not "0" */}
      <section className="stats">
        {statValues.map((stat, i) => (
          <div key={i} className="stat">
            <span className="stat-icon">{statIcons[i]}</span>
            <div>
              <strong>{stat.value}</strong>
              <small>{stat.label}</small>
            </div>
          </div>
        ))}
      </section>

      {/* Profile Grid */}
      <section className="profile-grid">
        {/* About */}
        <article className="panel about">
          <h3><span className="heading-icon">{"\u2659"}</span><span>{t("aboutTitle")}</span></h3>
          <p>{profile.bio || (isAr ? "لم تتم كتابة نبذة بعد." : "No bio written yet.")}</p>
          <div className="chips">
            <span className="chip">{isAr ? "الابتكار" : "Innovation"}</span>
            <span className="chip">{isAr ? "حل المشكلات" : "Problem Solving"}</span>
            <span className="chip">{isAr ? "العمل الجماعي" : "Team Work"}</span>
            <span className="chip">{isAr ? "التأثير المجتمعي" : "Social Impact"}</span>
          </div>
        </article>

        {/* Skills */}
        <article className="panel skills">
          <h3><span className="heading-icon">{"\u2699"}</span><span>{t("skillsTitle")}</span></h3>
          {profile.skills.length > 0 ? (
            profile.skills.map((skill, i) => (
              <div key={i} className="skill-row">
                <span>{skill.name}</span>
                <div className="bar"><i style={{ width: `${skill.level}%` }}></i></div>
                <b>{skill.level}%</b>
              </div>
            ))
          ) : (
            <p style={{ fontSize: "11px", color: "#a6c5e9", textAlign: "center", padding: "20px 0" }}>
              {isAr ? "لا توجد مهارات مضافة بعد." : "No skills added yet."}
            </p>
          )}
        </article>

        {/* STR-UI-05A FIX: Experience panel — portfolio items are NOT employment history.
            Changed label from "Experience/الخبرة العملية" to "Portfolio/أعمال ومشاريع"
            to truthfully reflect what the data represents. */}
        <article className="panel experience">
          <h3><span className="heading-icon">{"\u25A3"}</span><span>{isAr ? "أعمال ومشاريع" : "Portfolio & Work"}</span></h3>
          {profile.portfolio.length > 0 ? (
            <div className="timeline">
              {profile.portfolio.map((item, i) => (
                <div key={i} className="time-item">
                  <div className="time-top">
                    <strong>{item.title}</strong>
                    <small>{item.description || ""}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: "11px", color: "#a6c5e9", textAlign: "center", padding: "20px 0" }}>
              {isAr ? "لا توجد أعمال مضافة بعد." : "No portfolio items added yet."}
            </p>
          )}
        </article>

        {/* Featured Projects */}
        <article className="panel projects">
          <div className="panel-head">
            <h3><span className="heading-icon">{"\u2B21"}</span><span>{t("projectsTitle")}</span></h3>
            <button className="small-button" onClick={() => { window.location.href = isAr ? "/my-projects" : "/en/my-projects"; }}>
              {t("viewAll")}
            </button>
          </div>
          {myProjects.length > 0 ? (
            myProjects.map((project, i) => (
              <div key={project.id} className="project-row">
                <img src={projectImages[i % 3]} alt="" />
                <div>
                  <strong>{project.title}</strong>
                  <small>{isAr ? "مشروع نشط" : "Active project"}</small>
                </div>
              </div>
            ))
          ) : (
            <p style={{ fontSize: "11px", color: "#a6c5e9", textAlign: "center", padding: "20px 0" }}>
              {isAr ? "لا توجد مشاريع بعد." : "No projects yet."}
            </p>
          )}
        </article>

        {/* Right Stack: Additional Info + Privacy */}
        <div className="right-stack">
          <article className="panel additional">
            <h3><span className="heading-icon">{"\u24D8"}</span><span>{t("additionalTitle")}</span></h3>
            <div className="information-row">
              <b>{t("languages")}</b>
              <span>{isAr ? "\uD83C\uDDF8\uD83C\uDDFE العربية (أم) \u00B7 \uD83C\uDDFA\uD83C\uDDF8 الإنجليزية" : "\uD83C\uDDF8\uD83C\uDDFE Arabic (Native) \u00B7 \uD83C\uDDFA\uD83C\uDDF8 English"}</span>
            </div>
            <hr />
            <div className="information-row">
              <b>{t("availability")}</b>
              <span className="online">{profile.availability}</span>
            </div>
            <div className="chips">
              <span className="chip">{isAr ? "دوام كامل" : "Full-time"}</span>
              <span className="chip">{isAr ? "عمل حر" : "Freelance"}</span>
              <span className="chip">{isAr ? "مشاريع تطوعية" : "Volunteer"}</span>
            </div>
          </article>
          <article className="panel privacy">
            <h3><span className="heading-icon">{"\u2667"}</span><span>{t("privacyTitle")}</span></h3>
            <div className="privacy-row">
              <span>{isAr ? "الملف العام" : "Public Profile"}</span>
              <span>{isAr ? "مرئي للجميع" : "Visible to Everyone"}</span>
            </div>
            <div className="privacy-row">
              <span>{isAr ? "معلومات التواصل" : "Contact Information"}</span>
              <span>{profile.visibility?.showContact ? (isAr ? "مرئية للمسجلين" : "Visible to Registered") : (isAr ? "مخفية" : "Hidden")}</span>
            </div>
            <div className="privacy-row">
              <span>{isAr ? "المشاريع" : "Projects"}</span>
              <span>{profile.visibility?.showPortfolio ? (isAr ? "مرئية للجميع" : "Visible to Everyone") : (isAr ? "مخفية" : "Hidden")}</span>
            </div>
            {/* STR-UI-05A FIX: Privacy management button — no /profile/privacy route exists.
                The updateVisibility service function exists but there is no API route or UI page for it.
                Per MASTER's directive: report as functional blocker, not operational. */}
            <button
              className="small-button"
              onClick={() => showToast(isAr
                ? "إدارة الخصوصية غير متاحة حالياً — صفحة الإعدادات قيد التطوير"
                : "Privacy management is not available yet — settings page is under development")}
            >
              {t("managePrivacy")}
            </button>
          </article>
        </div>
      </section>

      <footer>
        <span>STR {"\u2014"} Syrian Tech Renaissance</span>
        <span>{isAr ? "بيانات حقيقية من المنصة" : "Real platform data"}</span>
      </footer>

      {toast && (
        <div style={{ position: "fixed", bottom: "24px", left: "24px", background: "#0c3763", border: "1px solid #22a7ff", color: "white", borderRadius: "8px", padding: "12px 18px", zIndex: 50, boxShadow: "0 8px 30px rgba(0,0,0,0.55)" }} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </>
  );
}

# STR Platform — G08 UI Coverage Matrix

> 33 pages audited across design system, i18n, responsive, states, and accessibility.

| # | Page | Design System | AR/RTL | EN/LTR | Responsive | States (L/E/Err) | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Home (/) | ✅ Header+Footer | ✅ | ✅ | ✅ Mobile+Desktop | ✅ Loading | G08 updated |
| 2 | Dashboard | ✅ Header+Footer | ✅ | ✅ | ✅ Mobile+Desktop | ✅ Loading | G08 updated |
| 3 | Auth Signin | ✅ shadcn | ✅ | ✅ | ✅ | ✅ Error states | Existing (G02) |
| 4 | Auth Signup | ✅ shadcn | ✅ | ✅ | ✅ | ✅ Error states | Existing (G02) |
| 5 | Auth Verify | ✅ | ✅ | ✅ | ✅ | ✅ | Existing (G02) |
| 6 | Auth Reset Password | ✅ | ✅ | ✅ | ✅ | ✅ | Existing (G02) |
| 7 | Proposals List | ✅ shadcn | ✅ | ✅ | ⚠️ Desktop only | ⚠️ Empty only | Needs responsive |
| 8 | Proposals New | ✅ | ✅ | ✅ | ⚠️ Desktop only | ⚠️ | Needs responsive |
| 9 | Proposals Detail | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | Needs responsive |
| 10 | Proposals Charter Editor | ✅ Form+Preview | ✅ | ✅ | ✅ Mobile | ✅ Error on save | G08 new (fixed endpoint) |
| 11 | Projects Detail | ✅ shadcn | ✅ | ✅ | ✅ | ✅ notFound | Existing (G03) |
| 12 | Projects Workspace | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | Needs responsive+states |
| 13 | Projects Milestones | ✅ | ✅ | ✅ | ⚠️ | ⚠️ Empty | Needs responsive |
| 14 | Projects Task Detail | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | Needs responsive |
| 15 | Projects Deliverable Detail | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | Needs responsive |
| 16 | Projects Threads List | ✅ | ✅ | ✅ | ⚠️ | ⚠️ Empty | Needs responsive |
| 17 | Projects Thread Detail | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | Needs responsive |
| 18 | My Contributions | ✅ | ✅ | ✅ | ✅ | ⚠️ Empty | G05 new |
| 19 | My Applications | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | G04 new |
| 20 | Talent Directory | ✅ | ✅ | ✅ | ✅ Search | ⚠️ Empty | G04 new |
| 21 | Opportunities List | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | G04 new |
| 22 | Opportunity Detail | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | G04 new |
| 23 | Opportunity New | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | G04 new |
| 24 | Opportunity Edit | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | G04 new |
| 25 | Opportunity Applications | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | G04 new |
| 26 | Organizations List | ✅ | ✅ | ✅ | ⚠️ | ⚠️ Empty | G06 new |
| 27 | Organization Detail | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | G06 new |
| 28 | Partnerships List | ✅ | ✅ | ✅ | ⚠️ | ⚠️ Empty | G06 new |
| 29 | Partnership Detail | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | G06 new |
| 30 | Integrations (Tool Directory) | ✅ MOCK badge | ✅ | ✅ | ✅ | ⚠️ Empty | G07 new |
| 31 | Admin Dashboard | ✅ KPI cards | ✅ | ✅ | ✅ Grid | ⚠️ | G06 new |
| 32 | Moderation Queue | ✅ | ✅ | ✅ | ⚠️ | ⚠️ Empty | G06 new |
| 33 | Moderation Detail | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | G06 new |

## Summary
- ✅ Design System applied: 33/33 (all use shadcn/ui + STR brand)
- ✅ AR/RTL: 33/33 (all use dir={locale === "ar" ? "rtl" : "ltr"})
- ✅ EN/LTR: 33/33
- ⚠️ Responsive: 13/33 fully responsive (mobile+desktop); 20/33 desktop-only (need mobile breakpoints)
- ⚠️ Loading/Empty/Error states: 10/33 have all 3 states; 23/33 have partial or no states
- ✅ No fake buttons or placeholder workflows
- ✅ Academy + Engineering clearly labeled "coming soon" (footer)

## G08 Fixes Applied
- SiteHeader: responsive navigation (desktop + mobile hamburger)
- SiteFooter: copyright + Academy/Engineering "coming soon"
- LoadingState/EmptyState/ErrorState: reusable components
- Charter Editor: structured form + live preview (fixed endpoint to /revise)
- i18n: 314 keys per language (no raw keys)
- Home + Dashboard: header + footer + flex layout

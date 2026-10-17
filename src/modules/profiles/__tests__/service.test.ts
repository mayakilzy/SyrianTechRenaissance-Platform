import { describe, it, expect } from "vitest";
import { calculateCompleteness, profileUpdateSchema } from "@/modules/profiles/service";

describe("Profile completeness calculation", () => {
  it("returns 0 for empty profile", () => {
    expect(calculateCompleteness({})).toBe(0);
  });

  it("returns 100 for fully filled profile", () => {
    expect(
      calculateCompleteness({
        displayName: "Test",
        headline: "Dev",
        bio: "Bio",
        avatarUrl: "https://example.com/a.png",
        contactEmail: "test@example.com",
        location: "Damascus",
        websiteUrl: "https://example.com",
      }),
    ).toBe(100);
  });

  it("returns correct percentage for partial profile", () => {
    // 3 of 7 fields filled = ~43%
    const pct = calculateCompleteness({
      displayName: "Test",
      headline: "Dev",
      bio: "Bio",
    });
    expect(pct).toBe(43);
  });

  it("ignores empty strings", () => {
    expect(calculateCompleteness({ displayName: "", headline: "  " })).toBe(0);
  });
});

describe("Profile update schema validation", () => {
  it("accepts a valid profile update", () => {
    const result = profileUpdateSchema.safeParse({
      displayName: "Test User",
      headline: "Software Engineer",
      bio: "A developer from Syria",
    });
    expect(result.success).toBe(true);
  });

  it("rejects displayName shorter than 2 chars", () => {
    const result = profileUpdateSchema.safeParse({ displayName: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects displayName longer than 100 chars", () => {
    const result = profileUpdateSchema.safeParse({
      displayName: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid avatarUrl", () => {
    const result = profileUpdateSchema.safeParse({
      displayName: "Test",
      avatarUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for optional URL fields (clears them)", () => {
    const result = profileUpdateSchema.safeParse({
      displayName: "Test",
      avatarUrl: "",
      websiteUrl: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects bio over 5000 chars", () => {
    const result = profileUpdateSchema.safeParse({
      displayName: "Test",
      bio: "x".repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid availability enum", () => {
    const result = profileUpdateSchema.safeParse({
      displayName: "Test",
      availability: "OPEN",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid availability value", () => {
    const result = profileUpdateSchema.safeParse({
      displayName: "Test",
      availability: "BUSY",
    });
    expect(result.success).toBe(false);
  });
});

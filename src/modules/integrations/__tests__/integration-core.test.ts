import { describe, it, expect } from "vitest";
import { validateProviderRegistration, MOCK_PROVIDER_ID, findCapability, riskPolicy, capabilitiesForProvider } from "@/modules/integrations";

describe("Integration Core — provider registration schema", () => {
  const valid = {
    slug: "str-mock",
    version: "1.0.0",
    displayName: "STR Mock Provider",
    description: "In-process mock provider for G07 integration tests.",
    owner: "system",
    baseOrigin: "https://mock.local.str.platform",
    authMode: { kind: "mock" },
    requestedCapabilities: [
      {
        code: "application.test",
        summary: "Mock capability exercising the full job lifecycle.",
        executionMode: "async",
        riskClass: "low",
        requiredScopes: ["mock:run"],
        idempotent: true,
        cancelable: true,
        timeoutMs: 30_000,
      },
    ],
  };

  it("accepts a well-formed registration", () => {
    const res = validateProviderRegistration(valid);
    expect(res.success).toBe(true);
  });

  it("rejects a non-HTTPS base origin (SSRF defense)", () => {
    const res = validateProviderRegistration({ ...valid, baseOrigin: "http://insecure" });
    expect(res.success).toBe(false);
  });

  it("rejects a malformed version", () => {
    const res = validateProviderRegistration({ ...valid, version: "1.0" });
    expect(res.success).toBe(false);
  });

  it("rejects a slug that is not kebab-case", () => {
    const res = validateProviderRegistration({ ...valid, slug: "STR_MOCK" });
    expect(res.success).toBe(false);
  });

  it("rejects OAuth2 mode missing issuer", () => {
    const res = validateProviderRegistration({
      ...valid,
      authMode: { kind: "oauth2_oidc", scopes: ["x"], pkce: true },
    });
    expect(res.success).toBe(false);
  });

  it("rejects empty capability list", () => {
    const res = validateProviderRegistration({ ...valid, requestedCapabilities: [] });
    expect(res.success).toBe(false);
  });
});

describe("Integration Core — capability catalogue", () => {
  it("declares the mock provider and its single capability", () => {
    expect(MOCK_PROVIDER_ID).toBe("str.mock.v1");
    const caps = capabilitiesForProvider(MOCK_PROVIDER_ID);
    expect(caps).toHaveLength(1);
    expect(caps[0]?.code).toBe("application.test");
  });

  it("findCapability returns undefined for unknown codes", () => {
    expect(findCapability("does.not.exist" as never)).toBeUndefined();
  });

  it("riskPolicy escalates controls with risk class", () => {
    expect(riskPolicy("low").requiresStewardApproval).toBe(false);
    expect(riskPolicy("high").requiresStewardApproval).toBe(true);
    expect(riskPolicy("critical").requiresDualControl).toBe(true);
    expect(riskPolicy("critical").maxRetries).toBe(0);
  });
});

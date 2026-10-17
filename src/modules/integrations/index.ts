/**
 * STR Integrations Core — Public Barrel
 * -------------------------------------
 * The only supported import path for other modules:
 *   import { types, capabilities, registrySchema } from "@/modules/integrations";
 *
 * G01 scope: types + capability catalogue + registration schema. No runtime
 * dispatcher, no routes, no fake connections. Functional slice is G07.
 */

export * as integrationTypes from "./types";
export * as integrationCapabilities from "./capabilities";
export * as integrationRegistry from "./registry-schema";

// Re-export the most commonly used symbols directly for ergonomics.
export {
  type ProviderDefinition,
  type CapabilityDefinition,
  type Connection,
  type IntegrationJob,
  type IntegrationEvent,
  type ConnectorV1,
  type ProviderId,
  type CapabilityCode,
  type ConnectionId,
  type IntegrationJobId,
  type ProviderTrustStatus,
  type ConnectionStatus,
  type IntegrationJobStatus,
} from "./types";

export {
  MOCK_PROVIDER_ID,
  CAPABILITY_CATALOGUE,
  findCapability,
  capabilitiesForProvider,
  riskPolicy,
  asProviderId,
  asCapabilityCode,
} from "./capabilities";

export {
  providerRegistrationSchema,
  validateProviderRegistration,
  type ProviderRegistration,
} from "./registry-schema";

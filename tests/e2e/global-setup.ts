/**
 * STR Playwright — Global Setup
 * -----------------------------
 * Runs once before the entire test suite. Clears the test email file so
 * each CI run starts with a clean state.
 */
import { clearTestEmails } from "./fixtures/test-emails";

export default function globalSetup() {
  clearTestEmails();
  console.log("[STR E2E] Cleared test email file");
}

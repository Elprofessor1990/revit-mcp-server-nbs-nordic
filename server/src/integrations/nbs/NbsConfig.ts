const DEFAULT_BASE_URL = "https://nbsnordic.net/api/v2";

// The public docs confirm V1 document endpoints (/documents, /documents/[id],
// /projects/[id]/documents) exist but never state their base path explicitly.
// This is inferred from the v2 convention (same host, /api/v1 instead of
// /api/v2) — NOT independently verified. Override with NBS_V1_BASE_URL once
// confirmed against a live account.
const DEFAULT_V1_BASE_URL = "https://nbsnordic.net/api/v1";

export interface NbsConfig {
  apiKey: string;
  baseUrl: string;
  v1BaseUrl: string;
  defaultProjectId?: string;
}

export function getNbsConfig(): NbsConfig {
  const apiKey = process.env.NBS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NBS_API_KEY is not set. Configure it as an environment variable (or, once built, via the NBS settings page in the Revit plugin)."
    );
  }
  return {
    apiKey,
    baseUrl: process.env.NBS_BASE_URL || DEFAULT_BASE_URL,
    v1BaseUrl: process.env.NBS_V1_BASE_URL || DEFAULT_V1_BASE_URL,
    defaultProjectId: process.env.NBS_PROJECT_ID,
  };
}

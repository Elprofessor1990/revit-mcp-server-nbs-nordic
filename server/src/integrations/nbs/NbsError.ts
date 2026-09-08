export type NbsErrorCode =
  | "AUTH_ERROR"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMIT"
  | "NETWORK_ERROR"
  | "NBS_API_ERROR"
  | "PRO_REQUIRED"
  | "AMBIGUOUS_MATCH";

export class NbsError extends Error {
  code: NbsErrorCode;
  status?: number;

  constructor(code: NbsErrorCode, message: string, status?: number) {
    super(message);
    this.name = "NbsError";
    this.code = code;
    this.status = status;
  }

  toJSON() {
    return { code: this.code, message: this.message, status: this.status };
  }
}

export function mapHttpStatusToNbsError(status: number, body: string): NbsError {
  if (status === 401) return new NbsError("AUTH_ERROR", "NBS API key was rejected (401).", status);
  if (status === 404) return new NbsError("NOT_FOUND", "NBS resource not found (404).", status);
  if (status === 400 || status === 422) return new NbsError("VALIDATION_ERROR", `NBS rejected the request (${status}): ${body}`, status);
  if (status === 429) return new NbsError("RATE_LIMIT", "NBS API rate limit hit (429).", status);
  if (status === 402 || status === 403) return new NbsError("PRO_REQUIRED", `NBS API returned ${status} — this endpoint may require a Pro subscription.`, status);
  return new NbsError("NBS_API_ERROR", `NBS API error (${status}): ${body}`, status);
}

import { getNbsConfig } from "./NbsConfig.js";
import { NbsError, mapHttpStatusToNbsError } from "./NbsError.js";

export interface NbsRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  /** Use the v1 base URL for this call instead of the default v2 one (document endpoints). */
  useV1?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30000;

export class NbsClient {
  async request<T = unknown>(path: string, options: NbsRequestOptions = {}): Promise<T> {
    const config = getNbsConfig();
    const base = options.useV1 ? config.v1BaseUrl : config.baseUrl;
    const url = `${base.replace(/\/$/, "")}${path}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          "api-key": config.apiKey,
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        throw mapHttpStatusToNbsError(response.status, text.slice(0, 500));
      }

      if (!text) return undefined as T;

      try {
        return JSON.parse(text) as T;
      } catch {
        // Non-JSON success body (e.g. binary export) — return raw text, caller decides what to do.
        return text as unknown as T;
      }
    } catch (error) {
      if (error instanceof NbsError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new NbsError(
          "NETWORK_ERROR",
          `NBS API request to ${path} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`
        );
      }
      throw new NbsError(
        "NETWORK_ERROR",
        `NBS API request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export const nbsClient = new NbsClient();

import type { Json } from "./types";

export async function api<T = Json>(path: string, options: { method?: string; body?: unknown; form?: FormData; auth?: boolean } = {}): Promise<T> {
  const init: RequestInit = { method: options.method || "GET", credentials: "same-origin", headers: {} };
  if (options.form) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false) throw new Error(data.error || data.reason || response.statusText);
  return data as T;
}

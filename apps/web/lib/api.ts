export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Fetch wrapper for the API (proxied same-origin under /api). Errors come back as ApiError with the server's code. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error ?? {};
    const err = new ApiError(res.status, e.code ?? "HTTP_" + res.status, e.message ?? `Request failed (${res.status})`, e.details);
    if (res.status === 401 && path !== "/auth/me" && path !== "/auth/login" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("prepkit:unauthorized", { detail: err }));
    }
    throw err;
  }
  return body as T;
}

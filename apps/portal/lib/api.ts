// All API calls go through Next.js rewrites (/api/* → api.grupo-loros.com/*)
const API = "/api";

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = sessionStorage.getItem("loros_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T = any>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const headers = { ...authHeaders(), ...(init?.headers as Record<string, string>) };

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = typeof body === "string" ? body : body?.detail || "Request failed";
    throw new Error(msg);
  }
  return body as T;
}

/** POST multipart/form-data (for job creation) */
export async function apiUpload<T = any>(
  path: string,
  formData: FormData
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: authHeaders(),
    credentials: "include",
    body: formData,
  });

  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = typeof body === "string" ? body : body?.detail || "Upload failed";
    throw new Error(msg);
  }
  return body as T;
}

/** Download a blob (for job output) */
export async function apiDownload(path: string, filename: string) {
  const res = await fetch(`${API}${path}`, {
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

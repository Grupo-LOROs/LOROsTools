function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = sessionStorage.getItem("loros_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function apiBase() {
  // Always use the rewrite proxy so cookies are same-origin.
  return "/api";
}

export function apiUrl(path: string) {
  return `${apiBase()}${path}`;
}

export async function apiFetch<T = any>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const headers = { ...authHeaders(), ...(init?.headers as Record<string, string>) };

  const res = await fetch(apiUrl(path), {
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

export async function apiUpload<T = any>(
  path: string,
  formData: FormData
): Promise<T> {
  const res = await fetch(apiUrl(path), {
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

export async function apiUploadDownload(
  path: string,
  formData: FormData,
  fallbackFilename: string
) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: authHeaders(),
    credentials: "include",
    body: formData,
  });

  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();
    const msg = typeof body === "string" ? body : body?.detail || "Download failed";
    throw new Error(msg);
  }

  const blob = await res.blob();
  const contentDisposition = res.headers.get("content-disposition") || "";
  const match = contentDisposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function apiDownload(path: string, filename: string) {
  const res = await fetch(apiUrl(path), {
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

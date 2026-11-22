import { ApiError } from "@/lib/errors";
import { mockApi } from "@/lib/mock-api";
import type { Job, VenueImportResult, VVApi } from "@/lib/types";

export { ApiError };

export const isMockMode = process.env.NEXT_PUBLIC_VV_MOCK === "1";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Can't reach the local API. Start it with `make dev`.");
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
      else if (body.detail) detail = JSON.stringify(body.detail);
    } catch {
      // Non-JSON error body (for example the proxy failing to reach the API).
      if (res.status >= 500) detail = "The local API isn't responding. Start it with `make dev`.";
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function detailFrom(text: string, status: number, statusText: string): string {
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (body.detail) return JSON.stringify(body.detail);
  } catch {
    if (status >= 500) return "The local API isn't responding. Start it with `make dev`.";
  }
  return `${status} ${statusText}`;
}

/** fetch() can't report upload progress, so large video uploads use XHR. */
function uploadWithProgress<T>(path: string, form: FormData, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    // Attach before sending so an abort that races the request start is never missed.
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => signal?.removeEventListener("abort", onAbort);
    xhr.open("POST", path);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T);
      } else {
        reject(new ApiError(xhr.status, detailFrom(xhr.responseText, xhr.status, xhr.statusText)));
      }
    };
    xhr.onerror = () => {
      done();
      reject(new ApiError(0, "Can't reach the local API. Start it with `make dev`."));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    xhr.send(form);
  });
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const enc = encodeURIComponent;

export const httpApi: VVApi = {
  backends: () => request("/api/system/backends"),
  listVenues: () => request("/api/venues"),
  createVenue: (body) => request("/api/venues", { method: "POST", ...json(body) }),
  getVenue: (id) => request(`/api/venues/${enc(id)}`),
  updateVenue: (id, body) => request(`/api/venues/${enc(id)}`, { method: "PATCH", ...json(body) }),
  deleteVenue: (id) => request(`/api/venues/${enc(id)}`, { method: "DELETE" }),
  createSpace: (venueId, body) =>
    request(`/api/venues/${enc(venueId)}/spaces`, { method: "POST", ...json(body) }),
  getSpace: (id) => request(`/api/spaces/${enc(id)}`),
  updateSpace: (id, body) => request(`/api/spaces/${enc(id)}`, { method: "PATCH", ...json(body) }),
  uploadPhotos: (spaceId, files) => {
    const form = new FormData();
    for (const file of files) form.append("files[]", file, file.name);
    return request(`/api/spaces/${enc(spaceId)}/photos`, { method: "POST", body: form });
  },
  deletePhoto: (id) => request(`/api/photos/${enc(id)}`, { method: "DELETE" }),
  generateBase: (spaceId, body) =>
    request(`/api/spaces/${enc(spaceId)}/generate-base`, { method: "POST", ...json(body) }),
  approvePhoto: (id) => request(`/api/photos/${enc(id)}/approve`, { method: "POST" }),
  chat: (spaceId, body) =>
    request(`/api/spaces/${enc(spaceId)}/chat`, { method: "POST", ...json(body) }),
  chatHistory: (spaceId) => request(`/api/spaces/${enc(spaceId)}/chat`),
  checkSpec: (body) => request("/api/spec/check", { method: "POST", ...json(body) }),
  defaultSpec: () => request("/api/spec/default"),
  listLooks: (spaceId) => request(`/api/spaces/${enc(spaceId)}/looks`),
  createLook: (spaceId, body) =>
    request(`/api/spaces/${enc(spaceId)}/looks`, { method: "POST", ...json(body) }),
  getLook: (id) => request(`/api/looks/${enc(id)}`),
  deleteLook: (id) => request(`/api/looks/${enc(id)}`, { method: "DELETE" }),
  renderLook: (id, body) =>
    request(`/api/looks/${enc(id)}/render`, { method: "POST", ...json(body) }),
  regenerateRender: (id, body) =>
    request(`/api/renders/${enc(id)}/regenerate`, { method: "POST", ...json(body) }),
  getJob: (id) => request(`/api/jobs/${enc(id)}`),
  cancelJob: (id) => request(`/api/jobs/${enc(id)}/cancel`, { method: "POST" }),
  research: (body) => request("/api/venues/research", { method: "POST", ...json(body) }),
  importVenue: (body) => request<VenueImportResult>("/api/venues/import", { method: "POST", ...json(body) }),
  uploadVideo: (venueId, file, { brain, onProgress, signal } = {}) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (brain) form.append("brain", brain);
    return uploadWithProgress<Job>(`/api/venues/${enc(venueId)}/video`, form, onProgress, signal);
  },
  applyVideo: (venueId, body) =>
    request(`/api/venues/${enc(venueId)}/video/apply`, { method: "POST", ...json(body) }),
  listJobs: (spaceId) => request(`/api/jobs?space_id=${enc(spaceId)}`),
  exportUrl: async (lookId) => `/api/looks/${enc(lookId)}/export.pdf`,
};

export const api: VVApi = isMockMode ? mockApi : httpApi;

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

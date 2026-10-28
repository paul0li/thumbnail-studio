// The backend's library API. Same origin: no CORS, no credentials to manage.

import type { PhotoRef } from "./document/types";

export type Role = "background" | "host" | "guest" | "logo" | "frame";
export type PersonRole = "host" | "guest";

export const isPersonRole = (role: Role): role is PersonRole => role === "host" || role === "guest";

export interface Photo {
  id: string;
  role: Role;
  width: number;
  height: number;
  url: string;
  original_url: string;
  has_alpha: boolean;
  cut_out: boolean;
  created_at: string;
}

export interface Config {
  roles: Role[];
  cutout: { available: boolean; roles: Role[] };
  max_upload_bytes: number;
}

export class ApiError extends Error {}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "Algo salió mal.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // keep the generic message
    }
    throw new ApiError(detail);
  }
  return (await response.json()) as T;
}

export async function getConfig(): Promise<Config> {
  return json<Config>(await fetch("/api/config"));
}

export async function listPhotos(): Promise<Photo[]> {
  return (await json<{ photos: Photo[] }>(await fetch("/api/photos"))).photos;
}

export interface UploadResult {
  photos: Photo[];
  errors: { filename: string | null; detail: string }[];
}

export async function uploadPhotos(role: Role, files: readonly File[]): Promise<UploadResult> {
  const form = new FormData();
  form.append("role", role);
  for (const file of files) form.append("files", file);
  const response = await fetch("/api/photos", { method: "POST", body: form });
  if (response.status === 422) {
    const body = (await response.json()) as Partial<UploadResult> & { detail?: unknown };
    if (Array.isArray(body.errors)) return { photos: [], errors: body.errors };
    throw new ApiError(typeof body.detail === "string" ? body.detail : "No se pudo subir.");
  }
  return json<UploadResult>(response);
}

export async function deletePhoto(id: string): Promise<void> {
  const response = await fetch(`/api/photos/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) await json(response);
}

/** Moves a person between host and guest (uploaded in the wrong step). */
export async function setRole(id: string, role: PersonRole): Promise<Photo> {
  return json<Photo>(
    await fetch(`/api/photos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    }),
  );
}

export async function cutOut(id: string): Promise<Photo> {
  return json<Photo>(await fetch(`/api/photos/${encodeURIComponent(id)}/cutout`, { method: "POST" }));
}

export function photoRef(photo: Photo): PhotoRef {
  return { photoId: photo.id, src: photo.url, width: photo.width, height: photo.height };
}

// Saved thumbnails (ADR 0009).

/** The server cannot be reached: no network, or the proxy in front of it
 *  answering for a server that is down. Never shown as «algo salió mal». */
export class Offline extends Error {}

/** The thumbnail moved on since the version a save was based on. */
export class Stale extends Error {
  constructor(readonly version: number) {
    super("stale");
  }
}

export class Gone extends Error {}

export interface ThumbnailSummary {
  id: string;
  version: number;
  title: string;
  created_at: string;
  updated_at: string;
  preview_url: string | null;
  /** The last download shows this exact version. */
  downloaded: boolean;
  export_url: string | null;
  exported_at: string | null;
}

export interface SavedVersion {
  version: number;
  document: unknown;
}

export interface ThumbnailState extends ThumbnailSummary {
  document: unknown;
  /** The undo path, oldest first, without the head. */
  history: SavedVersion[];
}

export interface SaveBody {
  base_version: number;
  parent_version: number | null;
  document: unknown;
}

const UNREACHABLE = new Set([502, 503, 504]);

async function call(input: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Offline();
  }
  if (UNREACHABLE.has(response.status)) throw new Offline();
  return response;
}

const id = (thumbnailId: string) => `/api/thumbnails/${encodeURIComponent(thumbnailId)}`;

export async function listThumbnails(): Promise<ThumbnailSummary[]> {
  return (await json<{ thumbnails: ThumbnailSummary[] }>(await call("/api/thumbnails", { cache: "no-cache" }))).thumbnails;
}

/** The thumbnail, or null if it does not exist (or was deleted). */
export async function getThumbnail(thumbnailId: string, history = 60): Promise<ThumbnailState | null> {
  const response = await call(`${id(thumbnailId)}?history=${history}`, { cache: "no-cache" });
  if (response.status === 404) return null;
  return json<ThumbnailState>(response);
}

export async function saveThumbnail(thumbnailId: string, body: SaveBody, options: { keepalive?: boolean } = {}): Promise<number> {
  const response = await call(id(thumbnailId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: options.keepalive,
  });
  if (response.status === 409) {
    const conflict = (await response.json()) as { version: number };
    throw new Stale(conflict.version);
  }
  if (response.status === 404) throw new Gone();
  return (await json<{ version: number }>(response)).version;
}

export async function duplicateThumbnail(thumbnailId: string): Promise<string> {
  return (await json<{ id: string }>(await call(`${id(thumbnailId)}/duplicate`, { method: "POST" }))).id;
}

export async function deleteThumbnail(thumbnailId: string): Promise<void> {
  const response = await call(id(thumbnailId), { method: "DELETE" });
  if (!response.ok && response.status !== 404) await json(response);
}

/** The browser's render of one version: a preview for the history, or the
 *  PNG that was just downloaded. */
export async function putPicture(thumbnailId: string, kind: "preview" | "export", version: number, blob: Blob): Promise<ThumbnailSummary> {
  const form = new FormData();
  form.append("file", blob, kind === "export" ? "miniatura.png" : "vista.jpg");
  return json<ThumbnailSummary>(await call(`${id(thumbnailId)}/${kind}?version=${version}`, { method: "PUT", body: form }));
}

/** A new thumbnail's id, chosen here so that a thumbnail made offline is
 *  created with the same id when the connection is back. */
export function newThumbnailId(): string {
  const random = new Uint8Array(6);
  crypto.getRandomValues(random);
  return Date.now().toString(16).padStart(12, "0") + Array.from(random, (b) => b.toString(16).padStart(2, "0")).join("");
}

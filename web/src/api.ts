// The backend's library API. Same origin: no CORS, no credentials to manage.

import type { PhotoRef } from "./document/types";

export type Role = "background" | "person" | "logo" | "frame";

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

export async function cutOut(id: string): Promise<Photo> {
  return json<Photo>(await fetch(`/api/photos/${encodeURIComponent(id)}/cutout`, { method: "POST" }));
}

export function photoRef(photo: Photo): PhotoRef {
  return { photoId: photo.id, src: photo.url, width: photo.width, height: photo.height };
}

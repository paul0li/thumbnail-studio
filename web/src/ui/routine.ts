// A new thumbnail starts the way every day does: the show's frame and logo
// on, and the host already in place. Only what changes daily is left to choose.

import { photoRef, type Photo } from "../api";
import { newDocument, people, setFrame, setHost, setLogo } from "../document/edit";
import type { DesignDocument } from "../document/types";

function pickPhoto(photos: readonly Photo[], role: Photo["role"], lastId: string | undefined): Photo | undefined {
  const ofRole = photos.filter((p) => p.role === role);
  // The one used last time, if it is still in the library; otherwise the newest.
  return ofRole.find((p) => p.id === lastId) ?? (role === "person" ? undefined : ofRole[0]);
}

/** A fresh document carrying over the frame, logo and host of `previous`
 *  (falling back to the newest frame and logo in the library). */
export function startOfDay(previous: DesignDocument | null, photos: readonly Photo[]): DesignDocument {
  const last = (kind: "frame" | "logo") => {
    const layer = previous?.layers.find((l) => l.kind === kind);
    return layer && layer.kind !== "title" && layer.photo ? layer.photo.photoId : undefined;
  };
  let doc = newDocument();
  const frame = pickPhoto(photos, "frame", last("frame"));
  if (frame) doc = setFrame(doc, photoRef(frame));
  const logo = pickPhoto(photos, "logo", last("logo"));
  if (logo) doc = setLogo(doc, photoRef(logo));
  const host = previous ? people(previous, "host")[0] : undefined;
  const hostPhoto = host ? pickPhoto(photos, "person", host.photo.photoId) : undefined;
  if (hostPhoto) doc = setHost(doc, photoRef(hostPhoto));
  return doc;
}

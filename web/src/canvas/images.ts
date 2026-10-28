// Images by URL, loaded once and shared by every redraw. Same origin, so the
// canvas is never tainted and can be exported.

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

/** The image if it is ready; otherwise starts loading it and returns null. */
export function imageFor(src: string, onReady: () => void): HTMLImageElement | null {
  const ready = cache.get(src);
  if (ready) return ready;
  if (!pending.has(src)) {
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        cache.set(src, image);
        pending.delete(src);
        resolve(image);
        onReady();
      };
      image.onerror = () => {
        pending.delete(src);
        reject(new Error(`could not load ${src}`));
      };
      image.src = src;
    });
    promise.catch(() => undefined);
    pending.set(src, promise);
  }
  return null;
}

/** Resolves once every image is loaded (or failed). */
export async function loadImages(srcs: readonly string[]): Promise<void> {
  await Promise.all(
    srcs.map(
      (src) =>
        new Promise<void>((resolve) => {
          if (imageFor(src, resolve)) resolve();
          else pending.get(src)?.then(() => resolve(), () => resolve()) ?? resolve();
        }),
    ),
  );
}

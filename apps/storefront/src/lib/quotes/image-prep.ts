/**
 * Makes a phone photo small enough to send, in the visitor's own browser: a 4 MB picture becomes a few hundred kilobytes (longest side
 * 1600 px, JPEG), and the metadata a photo carries (where it was taken, which phone) is dropped on the way, because only the picture's
 * pixels are redrawn. This is a courtesy for the visitor; the server and the shop check every picture again and do not trust this.
 * If the browser cannot decode the picture (an unusual format) the original is sent as it is and the server decides.
 */
export const MAX_EDGE = 1600;
const SMALL_ENOUGH = 700_000;
const JPEG_QUALITY = 0.82;

export function isPictureName(name: string, type: string): boolean {
  return /^image\/(jpeg|png|webp|gif)$/.test(type) || /\.(jpe?g|png|webp|gif)$/i.test(name);
}

export async function prepareImage(file: File): Promise<File> {
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file; // GIFs may be animated; unknown types are left to the server
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    // Already small in bytes AND in pixels: nothing to gain, and no reason to re-encode (and lose) it.
    if (file.size <= SMALL_ENOUGH && longest <= MAX_EDGE) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, MAX_EDGE / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }
    // A transparent PNG would turn black as a JPEG: paint white behind it.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[A-Za-z0-9]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    });
  } catch {
    return file;
  }
}

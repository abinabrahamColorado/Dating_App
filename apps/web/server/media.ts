import sharp from 'sharp';
import { accountConfig as c } from '@meetwell/config/accounts';
export { putPhoto, getPhoto, deletePhoto } from '@meetwell/runtime/media-storage';
export async function sanitizePhoto(input: Buffer): Promise<Buffer> {
  if (input.length > c.PHOTO_MAX_BYTES) throw new Error('PHOTO_TOO_LARGE');
  const image = sharp(input, {
    limitInputPixels: c.PHOTO_MAX_PIXELS,
    animated: false,
    failOn: 'warning',
  });
  const metadata = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) > 1)
    throw new Error('INVALID_PHOTO');
  // Spec P4/P22: decoding then re-encoding strips EXIF, GPS, ICC, XMP and appended bytes.
  return image
    .rotate()
    .resize(c.PHOTO_MAX_EDGE, c.PHOTO_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: c.PHOTO_JPEG_QUALITY })
    .toBuffer();
}

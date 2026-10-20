import sharp from 'sharp';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { accountConfig as c } from '@meetwell/config/accounts';
import { mediaCipher } from './runtime';
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
function storage() {
  return new S3Client({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MEDIA_ACCESS_KEY ?? '',
      secretAccessKey: process.env.MEDIA_SECRET_KEY ?? '',
    },
  });
}
const bucket = () => process.env.MEDIA_BUCKET ?? 'meetwell-private';
export async function putPhoto(id: string, buffer: Buffer) {
  await storage().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: id,
      Body: mediaCipher().seal(buffer.toString('base64'), `photo:${id}`),
      ContentType: 'application/octet-stream',
      IfNoneMatch: '*',
    }),
  );
}
export async function getPhoto(id: string): Promise<Buffer> {
  const result = await storage().send(new GetObjectCommand({ Bucket: bucket(), Key: id }));
  const body = await result.Body?.transformToString();
  if (!body) throw new Error('NOT_FOUND');
  return Buffer.from(mediaCipher().open<string>(body, `photo:${id}`), 'base64');
}
export async function deletePhoto(id: string) {
  await storage().send(new DeleteObjectCommand({ Bucket: bucket(), Key: id }));
}

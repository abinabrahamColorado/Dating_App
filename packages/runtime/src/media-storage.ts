import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import { mediaCipher } from './accounts';
function storage() {
  if (process.env.MEDIA_CDN_URL) throw Error('No CDN purge adapter is configured');
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
const checkId = (id: string) => {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('Invalid media key');
};
export async function putPhoto(id: string, buffer: Buffer) {
  checkId(id);
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
  checkId(id);
  const result = await storage().send(new GetObjectCommand({ Bucket: bucket(), Key: id }));
  const body = await result.Body?.transformToString();
  if (!body) throw Error('NOT_FOUND');
  return Buffer.from(mediaCipher().open<string>(body, `photo:${id}`), 'base64');
}
export async function mediaVersions(prefix?: string) {
  if (prefix) checkId(prefix);
  const client = storage(),
    values: { key: string; version: string | undefined; modified: Date }[] = [];
  let keyMarker: string | undefined, versionMarker: string | undefined;
  let more: boolean;
  do {
    const page = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket(),
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
      }),
    );
    for (const item of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])])
      if (item.Key && item.LastModified && (!prefix || item.Key === prefix))
        values.push({ key: item.Key, version: item.VersionId, modified: item.LastModified });
    more = !!page.IsTruncated;
    if (!more) break;
    keyMarker = page.NextKeyMarker;
    versionMarker = page.NextVersionIdMarker;
    if (!keyMarker) throw Error('Invalid storage pagination');
  } while (more);
  return values;
}
/** Remove all versions, including delete markers; never declare deletion after
 * merely hiding the latest object. A permissions/storage failure is retryable. */
export async function deletePhoto(id: string) {
  checkId(id);
  const client = storage();
  for (const item of await mediaVersions(id))
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket(), Key: id, VersionId: item.version }),
    );
  if ((await mediaVersions(id)).length) throw Error('Media purge incomplete');
}

import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
/** Development only; never imported by a request handler. */
export async function setupLocalStorage() {
  const endpoint = process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
  if (!['127.0.0.1', 'localhost'].includes(new URL(endpoint).hostname))
    throw new Error('Local storage only');
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ROOT_USER ?? 'meetwell-local',
      secretAccessKey: process.env.MINIO_ROOT_PASSWORD ?? 'local-storage-only',
    },
  });
  try {
    for (const Bucket of ['meetwell-private', 'meetwell-private-test']) {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch (e) {
        if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404)
          throw e;
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    }
  } finally {
    client.destroy();
  }
}

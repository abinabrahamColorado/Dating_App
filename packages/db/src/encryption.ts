import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
function pack(key: Buffer, input: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
function unpack(key: Buffer, input: string, context: string): Buffer {
  const blob = Buffer.from(input, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}
/** Spec P22: a fresh data key per value, wrapped by a separately provisioned boundary key.
 * Context authenticates record/field ownership. v1 is the key version, retained during rotation.
 */
export class Envelope {
  private key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('A 256-bit encryption key is required');
  }
  seal(value: unknown, context: string): string {
    const dataKey = randomBytes(32);
    return [
      'v1',
      pack(this.key, dataKey, `key:${context}`),
      pack(dataKey, Buffer.from(JSON.stringify(value)), context),
    ].join('.');
  }
  open<T>(value: string, context: string): T {
    const [version, wrapped, body] = value.split('.');
    if (version !== 'v1' || !wrapped || !body) throw new Error('Invalid encrypted value');
    return JSON.parse(
      unpack(unpack(this.key, wrapped, `key:${context}`), body, context).toString(),
    ) as T;
  }
}
export function lookupToken(key: string, value: string): string {
  const decoded = Buffer.from(key, 'base64');
  if (decoded.length !== 32) throw new Error('A separate 256-bit lookup key is required');
  return createHmac('sha256', decoded).update(value).digest('hex');
}

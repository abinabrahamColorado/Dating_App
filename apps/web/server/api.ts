import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { after, NextResponse } from 'next/server';
import { accountConfig as c } from '@meetwell/config/accounts';
import {
  emailSchema,
  profileSchema,
  preferencesSchema,
  policyCommandSchema,
  areaSchema,
  withinCohort,
} from '@meetwell/core/accounts';
import { StoreError, type Authority } from '@meetwell/db/accounts';
import { newToken } from '@meetwell/db/encryption';
import { store, appOrigin, requireDevelopmentEnrollment } from './runtime';
import { sanitizePhoto, putPhoto, getPhoto, deletePhoto } from './media';
import { deliverAuthMail } from './mail';
import { passkeyOptions, verifyPasskey } from './passkeys';
import { handleSafety } from './safety-api';
import { handleExplore } from './explore-api';
import { requireSupportedClient } from '@meetwell/db/client-policy';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';

export const SESSION_COOKIE = 'meetwell_session';
const BROWSER_COOKIE = 'meetwell_browser';
const uuid = z.uuid();
const headers = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers });
}
async function setCookie(name: string, value: string, maxAge: number) {
  (await cookies()).set(name, value, {
    httpOnly: true,
    secure: new URL(appOrigin()).protocol === 'https:',
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}
async function browserToken() {
  const existing = (await cookies()).get(BROWSER_COOKIE)?.value;
  if (existing) return existing;
  const value = newToken();
  await setCookie(BROWSER_COOKIE, value, c.SESSION_DAYS * 86400);
  return value;
}
async function authority(required = true): Promise<Authority | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const value = token ? await store().authority(token) : null;
  if (required && !value) throw new StoreError('UNAUTHORIZED');
  return value;
}
function recent(auth: Authority) {
  if (Date.now() - auth.authenticatedAt.getTime() > c.REAUTH_MINUTES * 60_000)
    throw new StoreError('REAUTH_REQUIRED');
}
function registered(auth: Authority) {
  if (!auth.registered || auth.age === null) throw new StoreError('REGISTRATION_REQUIRED');
}
async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  if (Number(request.headers.get('content-length') ?? 0) > limit)
    throw new StoreError('PAYLOAD_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new StoreError('INVALID_INPUT');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.length;
      if (total > limit) {
        await reader.cancel();
        throw new StoreError('PAYLOAD_TOO_LARGE');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
async function body(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    throw new StoreError('INVALID_INPUT');
  try {
    return JSON.parse((await boundedBody(request, c.JSON_MAX_BYTES)).toString());
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('INVALID_INPUT');
  }
}
function key(request: Request) {
  return uuid.parse(request.headers.get('idempotency-key'));
}
const errors: Record<string, [number, string]> = {
  UNAUTHORIZED: [401, 'Sign in to continue.'],
  FORBIDDEN: [403, 'This action is not available to this account.'],
  INDEPENDENT_REVIEW_REQUIRED: [403, 'A different safety reviewer must decide this appeal.'],
  INVALID_INPUT: [400, 'Check the form and try again.'],
  AGE_INELIGIBLE: [422, 'This pilot is for adults aged 18–30.'],
  INVALID_LINK: [400, 'This link is unavailable. Request a new link in this browser.'],
  INVALID_PASSKEY: [400, 'The passkey could not be verified. Try again or use an email link.'],
  STALE_VERSION: [409, 'Something changed. Refresh before trying again.'],
  IDEMPOTENCY_CONFLICT: [409, 'This request key has already been used. Refresh and try again.'],
  ACCOUNT_DISABLED: [403, 'Your account is not open to new activity.'],
  REAUTH_REQUIRED: [403, 'Sign in again before this sensitive change.'],
  NOT_READY: [422, 'Complete your profile, preferences and photo review first.'],
  REGISTRATION_REQUIRED: [403, 'Complete the eligibility step first.'],
  ALREADY_REGISTERED: [409, 'Your eligibility has already been recorded.'],
  PHOTO_LIMIT: [422, 'Remove a photo before adding another.'],
  PAYLOAD_TOO_LARGE: [413, 'The upload is too large. Choose a smaller file.'],
  NOT_FOUND: [404, 'This page or item is unavailable.'],
  PAIR_INELIGIBLE: [422, 'This introduction is not currently eligible.'],
  CAPACITY: [409, 'An introduction slot or weekly allowance is no longer available.'],
  BATCH_TOO_LARGE: [
    422,
    'This cohort exceeds the pilot review limit. Use a smaller operator-scoped batch.',
  ],
  SELF_REVIEW: [403, 'A different operator must review this batch.'],
  RATE_LIMITED: [429, 'Please wait a little before trying again.'],
  CLIENT_VERSION_DISABLED: [
    426,
    'This app version is temporarily unavailable. Update or reload the app. Reporting and help remain available.',
  ],
};
export async function handle(request: Request, path: string[]) {
  const requestId = randomUUID();
  try {
    requireDevelopmentEnrollment();
    const route = path.join('/');
    const db = store();
    if (request.method === 'POST') {
      if (
        request.headers.get('origin') !== appOrigin() ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        throw new StoreError('FORBIDDEN');
    }
    await requireSupportedClient(
      db,
      route,
      request.method,
      request.headers.get('x-meetwell-client-version'),
    );
    if (route === 'auth/request' && request.method === 'POST') {
      const data = z
        .object({
          email: emailSchema,
          purpose: z.enum(['apply', 'signin']),
          catchment: z.enum(['launch', 'outside']).optional(),
          areaId: z.string().optional(),
        })
        .strict()
        .parse(await body(request));
      if (
        data.purpose === 'apply' &&
        (data.catchment !== 'launch' || !areaSchema.safeParse(data.areaId).success)
      )
        return json({
          status: 'WAITLIST',
          message:
            'This pilot is limited to the listed Manhattan areas. Applications outside the catchment are not open yet. We have not saved your email.',
        });
      await db.requestMagicLink(data.email, await browserToken());
      after(async () => {
        try {
          await deliverAuthMail();
        } catch {
          /* Durable pending auth event is retried by the local mail runner. */
        }
      });
      return json({
        status: 'SENT',
        message: 'If a link can be sent, it will arrive shortly. Open it in this browser.',
      });
    }
    if (route === 'auth/consume' && request.method === 'POST') {
      const data = z
        .object({ token: z.string().min(32).max(128) })
        .strict()
        .parse(await body(request));
      const result = await db.consumeMagicLink(
        data.token,
        (await cookies()).get(BROWSER_COOKIE)?.value ?? '',
      );
      if ((await db.policy(result.memberId)).deletionRequested)
        throw new StoreError('ACCOUNT_DISABLED');
      await setCookie(SESSION_COOKIE, result.token, c.SESSION_DAYS * 86400);
      return json({ signedIn: true });
    }
    if (route.startsWith('auth/passkey/') && request.method === 'POST') {
      const data = z
        .object({
          kind: z.enum(['register', 'authenticate']),
          id: uuid.optional(),
          response: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
        .parse(await body(request));
      const auth = await authority(data.kind === 'register');
      const run = async () => {
        if (data.kind === 'register' && auth) {
          registered(auth);
          recent(auth);
        }
        const browser = await browserToken();
        if (!(await db.rateLimit(`passkey:${db.lookup(browser)}`, c.WRITE_REQUESTS_PER_MINUTE, 60)))
          throw new StoreError('RATE_LIMITED');
        if (route === 'auth/passkey/options')
          return json(await passkeyOptions(data.kind, browser, auth ?? undefined));
        if (route !== 'auth/passkey/verify' || !data.id || !data.response)
          throw new StoreError('INVALID_INPUT');
        // The WebAuthn library validates the cryptographic response; malformed shape is a generic failure.
        const result = await verifyPasskey(
          data.kind,
          data.id,
          browser,
          data.response as unknown as RegistrationResponseJSON | AuthenticationResponseJSON,
          auth ?? undefined,
        );
        if ('token' in result && result.token)
          await setCookie(SESSION_COOKIE, result.token, c.SESSION_DAYS * 86400);
        return json({ verified: true });
      };
      return auth ? await db.withSession(auth, run) : await run();
    }
    const auth = (await authority())!;
    return await db.withSession(auth, async () => {
      if (path[0] === 'explore' || (path[0] === 'ops' && path[1] === 'explore')) {
        registered(auth);
        return json(
          await handleExplore({
            auth,
            request,
            path,
            requestId,
            body: () => body(request),
            key: () => key(request),
          }),
        );
      }
      if (
        path[0] === 'safety' ||
        path[0] === 'members' ||
        (path[0] === 'ops' && path[1] === 'safety')
      ) {
        registered(auth);
        const result = await handleSafety({
          auth,
          request,
          path,
          requestId,
          body: () => body(request),
          key: () => key(request),
        });
        if (Buffer.isBuffer(result))
          return new Response(new Uint8Array(result), {
            headers: { ...headers, 'Content-Type': 'image/jpeg' },
          });
        return json(result);
      }
      if (
        request.method === 'POST' &&
        !(await db.rateLimit(`write:${auth.memberId}`, c.WRITE_REQUESTS_PER_MINUTE, 60))
      )
        throw new StoreError('RATE_LIMITED');
      if (route === 'me' && request.method === 'GET') {
        return json({
          registered: auth.registered,
          age: auth.age,
          cohortEligible: withinCohort(auth.age),
          policy: await db.policy(auth.memberId),
          profile: await db.profile(auth.memberId),
          preferences: await db.preferenceHistory(auth.memberId),
          photos: await db.photos(auth.memberId),
          roles: await db.staffRoles(auth.memberId),
        });
      }
      if (route === 'account/register' && request.method === 'POST') {
        await db.register(auth.memberId, await body(request));
        return json({ registered: true });
      }
      if (route === 'auth/signout' && request.method === 'POST') {
        await db.revokeSessions(auth, false);
        await setCookie(SESSION_COOKIE, '', 0);
        return json({ signedOut: true });
      }
      if (route === 'account/sessions' && request.method === 'GET')
        return json(await db.sessions(auth));
      if (route === 'account/sessions/revoke-others' && request.method === 'POST') {
        await db.revokeSessions(auth, true);
        return json({ revoked: true });
      }
      if (route === 'account/policy' && request.method === 'POST') {
        const command = policyCommandSchema.parse(await body(request));
        if (command.action === 'DELETE') recent(auth);
        const next = await db.changePolicy(auth, key(request), command);
        if (next.deletionRequested) await setCookie(SESSION_COOKIE, '', 0);
        return json(next);
      }
      registered(auth);
      if (route === 'profile' && request.method === 'POST') {
        const data = z
          .object({ version: z.number().int().nonnegative(), data: profileSchema })
          .strict()
          .parse(await body(request));
        return json(await db.saveProfile(auth.memberId, key(request), data.version, data.data));
      }
      if (route === 'preferences' && request.method === 'POST') {
        const data = z
          .object({ version: z.number().int().nonnegative(), data: preferencesSchema })
          .strict()
          .parse(await body(request));
        return json(await db.savePreferences(auth.memberId, key(request), data.version, data.data));
      }
      if (route === 'photos' && request.method === 'POST') {
        if (
          !['image/jpeg', 'image/png', 'image/webp'].includes(
            request.headers.get('content-type') ?? '',
          )
        )
          throw new StoreError('INVALID_INPUT');
        let photo: Buffer;
        try {
          photo = await sanitizePhoto(await boundedBody(request, c.PHOTO_MAX_BYTES));
        } catch (error) {
          if (error instanceof StoreError) throw error;
          throw new StoreError('INVALID_INPUT');
        }
        let written: string | undefined;
        try {
          return json(
            await db.addPhoto(
              auth.memberId,
              key(request),
              db.lookup(photo.toString('base64')),
              async (id) => {
                await putPhoto(id, photo);
                written = id;
              },
            ),
          );
        } catch (error) {
          if (written) await deletePhoto(written).catch(() => undefined);
          throw error;
        }
      }
      if (path[0] === 'photos' && path[1] && path.length <= 3) {
        const photoId = uuid.parse(path[1]);
        if (path.length === 2 && request.method === 'GET') {
          const bytes = await db.photoAccess(auth, photoId, false, requestId, () =>
            getPhoto(photoId),
          );
          return new Response(new Uint8Array(bytes), {
            headers: { ...headers, 'Content-Type': 'image/jpeg', 'Content-Disposition': 'inline' },
          });
        }
        if (path[2] === 'remove' && request.method === 'POST') {
          const result = await db.removePhoto(auth.memberId, key(request), photoId);
          await deletePhoto(photoId);
          return json(result);
        }
      }
      if (route === 'ops/photos' && request.method === 'GET')
        return json(await db.moderationQueue(auth.memberId, requestId));
      if (route === 'ops/audit' && request.method === 'GET')
        return json(await db.auditLog(auth.memberId, requestId));
      if (path[0] === 'ops' && path[1] === 'photos' && path[2] && path.length === 3) {
        const photoId = uuid.parse(path[2]);
        if (request.method === 'GET') {
          const bytes = await db.photoAccess(auth, photoId, true, requestId, () =>
            getPhoto(photoId),
          );
          return new Response(new Uint8Array(bytes), {
            headers: { ...headers, 'Content-Type': 'image/jpeg' },
          });
        }
        if (request.method === 'POST') {
          recent(auth);
          const data = z
            .object({ version: z.number().int().nonnegative(), approve: z.boolean() })
            .strict()
            .parse(await body(request));
          return json(
            await db.moderate(
              auth.memberId,
              key(request),
              photoId,
              data.version,
              data.approve,
              requestId,
            ),
          );
        }
      }
      throw new StoreError('NOT_FOUND');
    });
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? 'INVALID_INPUT'
        : error instanceof Error
          ? error.message
          : 'UNAVAILABLE';
    const [status, message] = errors[code] ?? [
      503,
      'This action is temporarily unavailable. Please try again.',
    ];
    // Never serialize validation inputs, SQL errors, email, birth date, media or server stack.
    if (status === 503)
      process.stderr.write(`${JSON.stringify({ event: 'api.unavailable', requestId })}\n`);
    return json({ error: message, requestId }, status);
  }
}

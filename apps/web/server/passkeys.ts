import { randomUUID } from 'node:crypto';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { transaction, StoreError, type Authority } from '@meetwell/db/accounts';
import { hashToken, newToken } from '@meetwell/db/encryption';
import { accountConfig as c } from '@meetwell/config/accounts';
import { appOrigin, store } from './runtime';
export async function passkeyOptions(
  kind: 'register' | 'authenticate',
  browser: string,
  authority?: Authority,
) {
  const db = store();
  const rpID = new URL(appOrigin()).hostname;
  if (kind === 'register' && !authority) throw new StoreError('UNAUTHORIZED');
  const existing = authority
    ? await db.identity.query<{ credential_id: string }>(
        'SELECT credential_id FROM identity.passkeys WHERE member_id=$1',
        [authority.memberId],
      )
    : null;
  const options =
    kind === 'register' && authority
      ? await generateRegistrationOptions({
          rpID,
          rpName: 'Meetwell',
          userName: `Member ${authority.memberId.slice(0, 8)}`,
          userID: new Uint8Array(Buffer.from(authority.memberId)),
          attestationType: 'none',
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          supportedAlgorithmIDs: [-7, -257], // Interoperable ES256/RS256; no experimental PQC runtime dependency.
          excludeCredentials: existing!.rows.map((row) => ({ id: row.credential_id })),
        })
      : await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const id = randomUUID();
  await db.identity.query(
    `INSERT INTO identity.challenges(id,member_id,session_id,challenge,purpose,browser_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 minute')`,
    [
      id,
      authority?.memberId ?? null,
      authority?.sessionId ?? null,
      options.challenge,
      kind,
      hashToken(browser),
      c.PASSKEY_CHALLENGE_MINUTES,
    ],
  );
  return { id, options };
}
export async function verifyPasskey(
  kind: 'register' | 'authenticate',
  id: string,
  browser: string,
  response: RegistrationResponseJSON | AuthenticationResponseJSON,
  authority?: Authority,
) {
  const db = store();
  return transaction(db.identity, async (client) => {
    // Single-use challenge, origin/RP verification, browser binding and session binding.
    const result = await client.query<{
      challenge: string;
      member_id: string | null;
      session_id: string | null;
    }>(
      'DELETE FROM identity.challenges WHERE id=$1 AND purpose=$2 AND browser_hash=$3 AND expires_at>now() RETURNING challenge,member_id,session_id',
      [id, kind, hashToken(browser)],
    );
    const challenge = result.rows[0];
    if (!challenge) throw new StoreError('INVALID_PASSKEY');
    if (kind === 'register') {
      if (
        !authority ||
        challenge.member_id !== authority.memberId ||
        challenge.session_id !== authority.sessionId
      )
        throw new StoreError('INVALID_PASSKEY');
      const verified = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: appOrigin(),
        expectedRPID: new URL(appOrigin()).hostname,
        requireUserVerification: true,
      });
      if (!verified.verified) throw new StoreError('INVALID_PASSKEY');
      const credential = verified.registrationInfo.credential;
      await client.query(
        'INSERT INTO identity.passkeys(credential_id,member_id,public_key,counter,transports) VALUES($1,$2,$3,$4,$5)',
        [
          credential.id,
          authority.memberId,
          Buffer.from(credential.publicKey),
          credential.counter,
          JSON.stringify(credential.transports ?? []),
        ],
      );
      return { registered: true };
    }
    const key = await client.query<{
      member_id: string;
      public_key: Buffer;
      counter: string;
      transports: string[];
    }>(
      'SELECT member_id,public_key,counter,transports FROM identity.passkeys WHERE credential_id=$1 FOR UPDATE',
      [response.id],
    );
    const credential = key.rows[0];
    if (!credential) throw new StoreError('INVALID_PASSKEY');
    const verified = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: appOrigin(),
      expectedRPID: new URL(appOrigin()).hostname,
      requireUserVerification: true,
      credential: {
        id: response.id,
        publicKey: new Uint8Array(credential.public_key),
        counter: Number(credential.counter),
        transports: credential.transports,
      },
    });
    if (!verified.verified) throw new StoreError('INVALID_PASSKEY');
    if ((await db.policy(credential.member_id)).deletionRequested)
      throw new StoreError('ACCOUNT_DISABLED');
    await client.query('UPDATE identity.passkeys SET counter=$2 WHERE credential_id=$1', [
      response.id,
      verified.authenticationInfo.newCounter,
    ]);
    const token = newToken();
    await client.query(
      `INSERT INTO identity.sessions(id,member_id,token_hash,expires_at)
      VALUES($1,$2,$3,now()+$4*interval '1 day')`,
      [randomUUID(), credential.member_id, hashToken(token), c.SESSION_DAYS],
    );
    return { token };
  });
}

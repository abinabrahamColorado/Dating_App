'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Policy, Profile, Preferences, StaffRole } from '@meetwell/core/accounts';
import type { Photo } from '@meetwell/db/accounts';
import { safetyConfig } from '@meetwell/config/safety';
export type Me = {
  registered: boolean;
  age: number | null;
  cohortEligible: boolean;
  policy: Policy;
  profile: { data: Profile; version: number } | null;
  preferences: {
    data: Preferences;
    version: number;
    priorVersion: number;
    source: string;
    updatedAt: string;
  }[];
  photos: Photo[];
  roles: StaffRole[];
};
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, data?: unknown, commandKey?: string): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-Meetwell-Client-Version': safetyConfig.CLIENT_VERSION },
    ...(data === undefined
      ? {}
      : {
          headers: {
            'X-Meetwell-Client-Version': safetyConfig.CLIENT_VERSION,
            'Content-Type': 'application/json',
            'Idempotency-Key': commandKey ?? crypto.randomUUID(),
          },
          body: JSON.stringify(data),
        }),
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error ?? 'Please try again.', response.status);
  return result as T;
}
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
export function useMember() {
  const [me, setMe] = useState<Me | null>(null),
    [error, setError] = useState('');
  const router = useRouter();
  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('me'));
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace('/signin');
      else setError(messageOf(e));
    }
  }, [router]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { me, error, refresh };
}
export function Notice({ error, status = '' }: { error: string; status?: string }) {
  return (
    <>
      <p className={error ? 'error' : 'sr-only'} role="alert">
        {error}
      </p>
      <p className={status ? 'notice' : 'sr-only'} role="status">
        {status}
      </p>
    </>
  );
}

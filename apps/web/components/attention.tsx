'use client';
import { useEffect } from 'react';
import { lifecycleConfig } from '@meetwell/config/lifecycle';
import { api } from './client';
/** No event payload is read or stored. Only a bounded active-second count leaves
 * the browser, after a separate opt-in. No unload/background tracking. */
export function AttentionMeasurement() {
  useEffect(() => {
    let enabled = false,
      alive = true,
      last = Date.now(),
      seconds = 0;
    void api<{ enabled: boolean }>('outcomes/attention')
      .then((x) => {
        if (alive) enabled = x.enabled;
      })
      .catch(() => undefined);
    const activity = () => {
      last = Date.now();
    };
    for (const name of ['pointerdown', 'keydown', 'wheel'])
      window.addEventListener(name, activity, { passive: true });
    const tick = setInterval(() => {
      if (
        enabled &&
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        Date.now() - last < lifecycleConfig.ATTENTION_IDLE_SECONDS * 1000
      )
        seconds = Math.min(lifecycleConfig.ATTENTION_MAX_SECONDS, seconds + 1);
    }, 1000);
    const send = setInterval(() => {
      const value = seconds;
      seconds = 0;
      if (enabled && value > 0)
        void api('outcomes/attention', { action: 'RECORD', seconds: value }).catch(() => undefined);
    }, lifecycleConfig.ATTENTION_MAX_SECONDS * 1000);
    return () => {
      alive = false;
      clearInterval(tick);
      clearInterval(send);
      for (const name of ['pointerdown', 'keydown', 'wheel'])
        window.removeEventListener(name, activity);
    };
  }, []);
  return null;
}

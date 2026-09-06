'use client';

import { useCallback, useEffect, useState } from 'react';

import { HiddenReason, HiddenTitles, readHidden, writeHidden } from '@/lib/recommendation-hidden';

/** The reader's hidden titles, read after mount so the server render matches the client. */
export function useHiddenTitles(uid: string) {
  const [hidden, setHidden] = useState<HiddenTitles>({});
  const [lastHidden, setLastHidden] = useState<string | null>(null);

  useEffect(() => {
    setHidden(uid ? readHidden(uid) : {});
    setLastHidden(null);
  }, [uid]);

  const hide = useCallback(
    (vnId: string, reason: HiddenReason) => {
      setHidden((previous) => {
        const next = { ...previous, [vnId]: reason };
        if (uid) writeHidden(uid, next);
        return next;
      });
      setLastHidden(vnId);
    },
    [uid],
  );

  const unhide = useCallback(
    (vnId: string) => {
      setHidden((previous) => {
        const next = { ...previous };
        delete next[vnId];
        if (uid) writeHidden(uid, next);
        return next;
      });
      setLastHidden((current) => (current === vnId ? null : current));
    },
    [uid],
  );

  const clear = useCallback(() => {
    setHidden({});
    setLastHidden(null);
    if (uid) writeHidden(uid, {});
  }, [uid]);

  return { hidden, hide, unhide, clear, lastHidden };
}

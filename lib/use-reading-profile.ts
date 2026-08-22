'use client';

import { useEffect, useState } from 'react';

import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { ReaderProfile } from '@/lib/vndb-stats-api';

/**
 * One reader's profile, fetched once however many cards read from it.
 *
 * Two cards on the stats page are built from the same payload, and asking for it twice cost
 * two requests and, worse, two independent moments of arrival: each card sized itself when its
 * own answer landed, so the page shifted twice under the reader.
 *
 * The cache is keyed by uid and holds the promise rather than the value, so a second caller
 * arriving mid-flight waits on the first request instead of starting another. It lives for the
 * page's lifetime, which is the right span: the data changes once a day, and a reader who
 * navigates away and back is served by the HTTP cache anyway.
 */

const inFlight = new Map<string, Promise<ReaderProfile | null>>();

export function loadReadingProfile(uid: string): Promise<ReaderProfile | null> {
  const existing = inFlight.get(uid);
  if (existing) return existing;

  // A failure is not an answer, so it is not kept. Cached, it would outlive the outage that
  // caused it and hide both cards for the rest of the session, including through the page's
  // own refresh.
  const request = vndbStatsApi
    .getReadingProfile(uid)
    .catch(() => {
      inFlight.delete(uid);
      return null;
    });
  inFlight.set(uid, request);
  return request;
}

export interface ReadingProfileState {
  profile: ReaderProfile | null;
  loading: boolean;
}

export function useReadingProfile(uid: string): ReadingProfileState {
  const [state, setState] = useState<ReadingProfileState>({ profile: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ profile: null, loading: true });
    loadReadingProfile(uid).then((profile) => {
      if (cancelled) return;
      setState({ profile, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return state;
}

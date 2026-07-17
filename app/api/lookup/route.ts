import { NextRequest, NextResponse } from 'next/server';
import { findEmail, type FindResult } from '@/lib/finder';
import { getCachedDiscovery, recordVerification } from '@/lib/verifications';
import { canUseBulk } from '@/lib/access';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, domain, source, cacheOnly } = await req.json();
    if (!firstName || !lastName || !domain) {
      return NextResponse.json({ error: 'firstName, lastName, domain required' }, { status: 400 });
    }

    if (source === 'bulk') {
      const supabase = createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!(await canUseBulk(user?.email))) {
        return NextResponse.json({ error: 'bulk access not enabled' }, { status: 403 });
      }
    }

    // Reuse a recent stored discovery for this contact (any user, 90-day
    // window) instead of re-running the pattern sweep — including stored
    // `not found` outcomes.
    {
      const fn = String(firstName).trim();
      const ln = String(lastName).trim();
      const d = String(domain).trim().toLowerCase();
      const hit = await getCachedDiscovery(fn, ln, d);
      if (hit) {
        const cachedResult: FindResult = {
          email: hit.email,
          status: hit.status as FindResult['status'],
          confidence: Number(hit.confidence),
          mx: null,
          patternIndex: hit.pattern_index,
          apiCalls: 0,
          creditsLeft: null,
          rr:
            hit.reacher_status
              ? { status: hit.reacher_status as NonNullable<FindResult['rr']>['status'], confidence: Number(hit.reacher_confidence ?? 0) }
              : null,
          mv:
            hit.millionverifier_status
              ? { status: hit.millionverifier_status as NonNullable<FindResult['mv']>['status'], confidence: Number(hit.millionverifier_confidence ?? 0) }
              : null,
          cached: true,
          cachedAt: hit.created_at,
        };
        // Record the hit so history reflects it; api_calls 0 keeps credit
        // stats accurate and keeps this row out of future cache lookups.
        await recordVerification({
          kind: 'find',
          source: source === 'bulk' ? 'bulk' : 'manual',
          first_name: fn,
          last_name: ln,
          domain: d,
          email: hit.email,
          status: hit.status,
          confidence: Number(hit.confidence),
          pattern_index: hit.pattern_index,
          api_calls: 0,
          credits_left: null,
          reacher_status: hit.reacher_status,
          reacher_confidence: hit.reacher_confidence,
          millionverifier_status: hit.millionverifier_status,
          millionverifier_confidence: hit.millionverifier_confidence,
        });
        return NextResponse.json(cachedResult);
      }
    }

    // cacheOnly: the bulk cache sweep probing for hits — report the miss
    // without running the pattern sweep; the caller retries for real later.
    if (cacheOnly) {
      return NextResponse.json({ miss: true });
    }

    const result = await findEmail(String(firstName), String(lastName), String(domain));

    await recordVerification({
      kind: 'find',
      source: source === 'bulk' ? 'bulk' : 'manual',
      first_name: String(firstName),
      last_name: String(lastName),
      domain: String(domain).trim().toLowerCase(),
      email: result.email,
      status: result.status,
      confidence: result.confidence,
      pattern_index: result.patternIndex ?? null,
      api_calls: result.apiCalls,
      credits_left: result.creditsLeft ?? null,
      reacher_status: result.rr?.status ?? null,
      reacher_confidence: result.rr?.confidence ?? null,
      millionverifier_status: result.mv?.status ?? null,
      millionverifier_confidence: result.mv?.confidence ?? null,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}

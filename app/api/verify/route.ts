import { NextRequest, NextResponse } from 'next/server';
import { verifyEmail, verifyWithMv, type VerifyResult } from '@/lib/finder';
import { getCachedVerification, recordVerification } from '@/lib/verifications';
import { canUseBulk } from '@/lib/access';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, source, mvOnly, cacheOnly } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
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
    // Reuse a recent stored verdict (any user, 90-day window) instead of
    // spending a verifier credit. mvOnly is an explicit force-recheck, so it
    // always bypasses the cache.
    const normalized = String(email).trim().toLowerCase();
    if (!mvOnly) {
      const hit = await getCachedVerification(normalized);
      if (hit) {
        const cachedResult: VerifyResult = {
          email: hit.email,
          status: hit.status,
          confidence: Number(hit.confidence),
          mx: null,
          apiCalls: 0,
          creditsLeft: null,
          rr:
            hit.reacher_status
              ? { status: hit.reacher_status as VerifyResult['status'], confidence: Number(hit.reacher_confidence ?? 0) }
              : null,
          mv:
            hit.millionverifier_status
              ? { status: hit.millionverifier_status as VerifyResult['status'], confidence: Number(hit.millionverifier_confidence ?? 0) }
              : null,
          cached: true,
          cachedAt: hit.created_at,
        };
        // Record the hit so the user's history reflects it; api_calls 0 keeps
        // admin credit stats accurate.
        await recordVerification({
          kind: 'verify',
          source: source === 'bulk' ? 'bulk' : 'manual',
          first_name: null,
          last_name: null,
          domain: hit.email.includes('@') ? hit.email.split('@')[1] : null,
          email: hit.email,
          status: hit.status,
          confidence: Number(hit.confidence),
          pattern_index: null,
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
    // without spending a verifier call; the caller retries for real later.
    if (cacheOnly) {
      return NextResponse.json({ miss: true });
    }

    // mvOnly: user clicked "check with MillionVerifier" — force an MV check.
    const result = mvOnly ? await verifyWithMv(normalized) : await verifyEmail(normalized);

    const domain = result.email.includes('@') ? result.email.split('@')[1] : null;
    await recordVerification({
      kind: 'verify',
      source: source === 'bulk' ? 'bulk' : 'manual',
      first_name: null,
      last_name: null,
      domain,
      email: result.email,
      status: result.status,
      confidence: result.confidence,
      pattern_index: null,
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

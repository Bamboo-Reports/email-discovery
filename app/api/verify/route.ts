import { NextRequest, NextResponse } from 'next/server';
import { verifyEmail, verifyWithMv } from '@/lib/finder';
import { recordVerification } from '@/lib/verifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, source, mvOnly } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
    }
    // mvOnly: user clicked "check with MillionVerifier" — force an MV check.
    const result = mvOnly ? await verifyWithMv(String(email)) : await verifyEmail(String(email));

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

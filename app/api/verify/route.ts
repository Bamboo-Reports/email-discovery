import { NextRequest, NextResponse } from 'next/server';
import { verifyEmail } from '@/lib/finder';
import { recordVerification } from '@/lib/verifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, source } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
    }
    const result = await verifyEmail(String(email));

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
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { findEmail } from '@/lib/finder';
import { recordVerification } from '@/lib/verifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, domain, source } = await req.json();
    if (!firstName || !lastName || !domain) {
      return NextResponse.json({ error: 'firstName, lastName, domain required' }, { status: 400 });
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
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getMillionVerifierCredits } from '@/lib/millionverifier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Pure reacher has no credit concept; report null so the UI shows n/a.
    // BOTH mode still consumes MV credits (second opinions), so fall through.
    if (process.env.VERIFICATION_METHOD === 'RR') {
      return NextResponse.json({ credits: null });
    }
    const credits = await getMillionVerifierCredits();
    return NextResponse.json(credits);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getMillionVerifierCredits } from '@/lib/millionverifier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const credits = await getMillionVerifierCredits();
    return NextResponse.json(credits);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}

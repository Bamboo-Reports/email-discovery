import { NextRequest, NextResponse } from 'next/server';
import { verifyEmail } from '@/lib/finder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
    }
    const result = await verifyEmail(String(email));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}

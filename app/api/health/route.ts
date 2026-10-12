import { NextResponse } from 'next/server';
import { getBackendHealth } from '@/lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getBackendHealth());
}

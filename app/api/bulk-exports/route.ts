import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { canUseBulk } from '@/lib/access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'bulk-exports';
const MODES = new Set(['discovery', 'verification']);

function intCount(value: unknown): number {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function safeFilename(value: unknown, fallback: string): string {
  const raw = String(value || fallback).trim() || fallback;
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.endsWith('.csv') ? cleaned : `${cleaned || fallback}.csv`;
}

export async function GET() {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await canUseBulk(user.email))) {
      return NextResponse.json({ error: 'bulk access not enabled' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('bulk_exports')
      .select('id,created_at,mode,filename,row_count,valid_count,accept_all_count,invalid_count,not_found_count')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ exports: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await canUseBulk(user.email))) {
      return NextResponse.json({ error: 'bulk access not enabled' }, { status: 403 });
    }

    const body = await req.json();
    const mode = String(body.mode || '');
    const csv = String(body.csv || '');
    if (!MODES.has(mode)) return NextResponse.json({ error: 'invalid bulk mode' }, { status: 400 });
    if (!csv.trim()) return NextResponse.json({ error: 'csv required' }, { status: 400 });

    const id = randomUUID();
    const filename = safeFilename(body.filename, `${mode}_bulk_export.csv`);
    const storagePath = `${user.id}/${id}.csv`;
    const counts = body.counts ?? {};
    const row = {
      id,
      user_id: user.id,
      user_email: user.email ?? null,
      mode,
      filename,
      storage_path: storagePath,
      row_count: intCount(counts.rowCount),
      valid_count: intCount(counts.validCount),
      accept_all_count: intCount(counts.acceptAllCount),
      invalid_count: intCount(counts.invalidCount),
      not_found_count: intCount(counts.notFoundCount),
    };

    const admin = createSupabaseAdminClient();
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, csv, {
        contentType: 'text/csv;charset=utf-8',
        upsert: false,
      });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

    const { data, error: insertError } = await admin
      .from('bulk_exports')
      .insert(row)
      .select('id,created_at,mode,filename,row_count,valid_count,accept_all_count,invalid_count,not_found_count')
      .single();

    if (insertError) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ export: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}

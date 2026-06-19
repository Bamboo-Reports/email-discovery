import { NextRequest, NextResponse } from 'next/server';
import { canUseBulk } from '@/lib/access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'bulk-exports';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await canUseBulk(user.email))) {
      return NextResponse.json({ error: 'bulk access not enabled' }, { status: 403 });
    }

    const { data: exportRow, error } = await supabase
      .from('bulk_exports')
      .select('storage_path,filename')
      .eq('id', params.id)
      .single();

    if (error || !exportRow) {
      return NextResponse.json({ error: 'export not found' }, { status: 404 });
    }

    const admin = createSupabaseAdminClient();
    const { data, error: signedError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(exportRow.storage_path, 60, {
        download: exportRow.filename,
      });

    if (signedError || !data?.signedUrl) {
      return NextResponse.json({ error: signedError?.message ?? 'download unavailable' }, { status: 500 });
    }

    return NextResponse.redirect(data.signedUrl);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}

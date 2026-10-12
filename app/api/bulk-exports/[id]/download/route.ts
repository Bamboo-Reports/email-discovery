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
    if (!user) return NextResponse.json({ error: 'you’re signed out. sign in again.' }, { status: 401 });
    if (!(await canUseBulk(user.email))) {
      return NextResponse.json({ error: 'bulk access isn’t turned on for your account. ask an admin.' }, { status: 403 });
    }

    const { data: exportRow, error } = await supabase
      .from('bulk_exports')
      .select('storage_path,filename')
      .eq('id', params.id)
      .single();

    if (error || !exportRow) {
      return NextResponse.json({ error: 'this export no longer exists.' }, { status: 404 });
    }

    const admin = createSupabaseAdminClient();
    const { data, error: signedError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(exportRow.storage_path, 60, {
        download: exportRow.filename,
      });

    if (signedError || !data?.signedUrl) {
      return NextResponse.json({ error: signedError?.message ?? 'download isn’t available right now. try again.' }, { status: 500 });
    }

    return NextResponse.redirect(data.signedUrl);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'something went wrong. try again.' }, { status: 500 });
  }
}

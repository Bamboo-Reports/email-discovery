import { createSupabaseServerClient } from './supabase/server';
import { logEvent } from './log';

export interface BulkExportRow {
  id: string;
  created_at: string;
  mode: 'discovery' | 'verification';
  filename: string;
  row_count: number;
  valid_count: number;
  accept_all_count: number;
  invalid_count: number;
  not_found_count: number;
}

const BULK_EXPORT_LIMIT = 100;

export async function getMyBulkExports(limit = BULK_EXPORT_LIMIT): Promise<BulkExportRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('bulk_exports')
    .select('id,created_at,mode,filename,row_count,valid_count,accept_all_count,invalid_count,not_found_count')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logEvent('bulk-exports', 'history-error', { error: error.message });
    return [];
  }

  return (data ?? []) as BulkExportRow[];
}

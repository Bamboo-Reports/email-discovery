import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/supabase/admin';
import { getAdminOverview } from '@/lib/verifications';
import { getMillionVerifierCredits, type MillionVerifierCredits } from '@/lib/millionverifier';
import { StatusBadge } from '@/components/StatusBadge';
import { PaginatedTabs } from '@/components/PaginatedTabs';
import { BulkToggle } from '@/components/BulkToggle';
import { getEnabledBulkEmails } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fmt(ts: string) {
  return new Date(ts).toLocaleString();
}

export default async function AdminPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email)) {
    redirect('/');
  }

  const o = await getAdminOverview();
  const bulkEnabled = await getEnabledBulkEmails();

  let credits: MillionVerifierCredits | null = null;
  try {
    credits = await getMillionVerifierCredits();
  } catch {
    credits = null;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>admin · usage</h1>
          <p className="page-sub">all verifications across the org, per-user activity, and credit usage.</p>
        </div>
      </header>

      <div className="stat-strip">
        <div className="stat"><div className="stat-value">{o.totalVerifications}</div><div className="stat-label">total attempts</div></div>
        <div className="stat"><div className="stat-value">{o.totalDiscovered}</div><div className="stat-label">discovered (valid + accept-all)</div></div>
        <div className="stat"><div className="stat-value">{o.totalApiCalls}</div><div className="stat-label">api calls / credits</div></div>
        <div className="stat"><div className="stat-value">{o.distinctUsers}</div><div className="stat-label">users</div></div>
      </div>

      <div className="card">
        <div className="card-head">
          <h4>millionverifier account</h4>
          <span className="small">live balance</span>
        </div>
        <div className="card-body">
          {credits ? (
            <div className="stat-strip">
              <div className="stat"><div className="stat-value">{credits.credits.toLocaleString()}</div><div className="stat-label">credits remaining</div></div>
              <div className="stat"><div className="stat-value">{credits.bulk_credits.toLocaleString()}</div><div className="stat-label">bulk credits</div></div>
              <div className="stat"><div className="stat-value">{credits.renewing_credits.toLocaleString()}</div><div className="stat-label">renewing</div></div>
              <div className="stat"><div className="stat-value">{credits.plan}</div><div className="stat-label">plan</div></div>
            </div>
          ) : (
            <div className="small">could not load credit balance (check MILLIONVERIFIER_API_KEY).</div>
          )}
        </div>
      </div>

      <PaginatedTabs
        emptyText="no activity yet."
        tabs={[
          {
            id: 'activity',
            label: 'recent activity',
            head: (
              <tr><th>when</th><th>user</th><th>email</th><th>status</th></tr>
            ),
            rows: o.recent.map((r) => (
              <tr key={r.id}>
                <td className="small">{fmt(r.created_at)}</td>
                <td>{r.user_email}</td>
                <td className="mono">{r.email || '—'}</td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            )),
          },
          {
            id: 'per-user',
            label: 'per user',
            head: (
              <tr>
                <th>user</th><th>bulk</th><th>attempts</th><th>valid</th><th>accept-all</th>
                <th>invalid</th><th>not found</th><th>api calls</th><th>last active</th>
              </tr>
            ),
            rows: o.perUser.map((u) => (
              <tr key={u.user_email}>
                <td>{u.user_email}</td>
                <td><BulkToggle email={u.user_email} enabled={bulkEnabled.has(u.user_email.toLowerCase())} /></td>
                <td>{u.total}</td>
                <td>{u.valid}</td>
                <td>{u.acceptAll}</td>
                <td>{u.invalid}</td>
                <td>{u.notFound}</td>
                <td>{u.apiCalls}</td>
                <td className="small">{fmt(u.lastActive)}</td>
              </tr>
            )),
          },
        ]}
      />

      <p className="foot">internal · email workbench · admin</p>
    </div>
  );
}

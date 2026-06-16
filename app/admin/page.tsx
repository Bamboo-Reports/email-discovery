import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/supabase/admin';
import { getAdminOverview } from '@/lib/verifications';
import { getMillionVerifierCredits, type MillionVerifierCredits } from '@/lib/millionverifier';
import { StatusBadge } from '@/components/StatusBadge';

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

      <div className="card">
        <div className="card-head"><h4>per user</h4></div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>user</th>
                <th>attempts</th>
                <th>valid</th>
                <th>accept-all</th>
                <th>invalid</th>
                <th>not found</th>
                <th>domains</th>
                <th>api calls</th>
                <th>last active</th>
              </tr>
            </thead>
            <tbody>
              {o.perUser.length === 0 && (
                <tr><td colSpan={9} className="small">no activity yet.</td></tr>
              )}
              {o.perUser.map((u) => (
                <tr key={u.user_email}>
                  <td className="cell-email">{u.user_email}</td>
                  <td>{u.total}</td>
                  <td>{u.valid}</td>
                  <td>{u.acceptAll}</td>
                  <td>{u.invalid}</td>
                  <td>{u.notFound}</td>
                  <td>{u.domains}</td>
                  <td>{u.apiCalls}</td>
                  <td className="small">{fmt(u.lastActive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h4>top domains</h4></div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>domain</th><th>lookups</th></tr></thead>
              <tbody>
                {o.topDomains.length === 0 && <tr><td colSpan={2} className="small">—</td></tr>}
                {o.topDomains.map((d) => (
                  <tr key={d.domain}><td className="cell-domain">{d.domain}</td><td>{d.count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h4>recent activity</h4></div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>when</th><th>user</th><th>email</th><th>status</th></tr></thead>
              <tbody>
                {o.recent.length === 0 && <tr><td colSpan={4} className="small">—</td></tr>}
                {o.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{fmt(r.created_at)}</td>
                    <td className="cell-email">{r.user_email}</td>
                    <td className="cell-email">{r.email || '—'}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="foot">internal · email workbench · admin</p>
    </div>
  );
}

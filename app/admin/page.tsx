import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/supabase/admin';
import { getAdminOverview, getAdminPeriodStats, getPerUserStatsByPeriod, type UserStats } from '@/lib/verifications';
import { getMillionVerifierCredits, type MillionVerifierCredits } from '@/lib/millionverifier';
import {
  RiCheckboxCircleLine,
  RiCoinsLine,
  RiFileList3Line,
  RiFlashlightLine,
  RiPulseLine,
  RiTeamLine,
} from '@remixicon/react';
import { StatusBadge } from '@/components/StatusBadge';
import { PaginatedTabs } from '@/components/PaginatedTabs';
import { TeamTable, type TeamCounts, type TeamMember } from '@/components/TeamTable';
import { UsageOverTime } from '@/components/UsageOverTime';
import { getEnabledBulkEmails, getGrantedAdmins, isAdmin } from '@/lib/access';
import { getAuthAccounts } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


// Below this many MillionVerifier credits the balance tile turns amber.
const LOW_CREDITS = 1000;

const num = (n: number) => n.toLocaleString('en-US');

function fullTime(ts: string) {
  return new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

/** "just now" / "12m ago" / "5h ago" / "3d ago", then a short date. */
function ago(ts: string) {
  const mins = Math.floor((Date.now() - Date.parse(ts)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 30 * 24 * 60) return `${Math.floor(mins / (24 * 60))}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
}

export default async function AdminPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !(await isAdmin(user.email))) {
    redirect('/');
  }
  const me = user.email.toLowerCase();

  const [o, bulkEnabled, periodStats, credits, accounts, grantedAdmins, userPeriods] = await Promise.all([
    getAdminOverview(),
    getEnabledBulkEmails(),
    getAdminPeriodStats(),
    getMillionVerifierCredits().catch((): MillionVerifierCredits | null => null),
    getAuthAccounts(),
    getGrantedAdmins(),
    getPerUserStatsByPeriod(),
  ]);

  // Team = everyone with history, plus login accounts that never ran a lookup.
  const zero: TeamCounts = { total: 0, valid: 0, acceptAll: 0, invalid: 0, notFound: 0, apiCalls: 0 };
  const counts = (u?: UserStats): TeamCounts => (u ? {
    total: u.total, valid: u.valid, acceptAll: u.acceptAll, invalid: u.invalid, notFound: u.notFound, apiCalls: u.apiCalls,
  } : zero);
  const byEmail = (rows: UserStats[]) => new Map(rows.map((u) => [u.user_email.toLowerCase(), u]));
  const allTime = byEmail(o.perUser);
  const period = {
    today: byEmail(userPeriods.today),
    week: byEmail(userPeriods.week),
    month: byEmail(userPeriods.month),
    year: byEmail(userPeriods.year),
  };
  const emails = Array.from(new Set([...Array.from(allTime.keys()), ...Array.from(accounts.keys())]));
  const members: TeamMember[] = emails.map((email) => {
    const account = accounts.get(email);
    const owner = isAdminEmail(email);
    const admin = owner || grantedAdmins.has(email);
    const lastActive = allTime.get(email)?.lastActive ?? '';
    return {
      email,
      role: owner ? 'owner' : admin ? 'admin' : 'member',
      bulk: admin || bulkEnabled.has(email),
      archived: !!account?.archived,
      hasLogin: !!account,
      isSelf: email === me,
      lastActive: lastActive ? ago(lastActive) : 'never',
      lastActiveTitle: lastActive ? fullTime(lastActive) : 'no lookups yet',
      counts: {
        today: counts(period.today.get(email)),
        week: counts(period.week.get(email)),
        month: counts(period.month.get(email)),
        year: counts(period.year.get(email)),
        all: counts(allTime.get(email)),
      },
    };
  });

  const creditTone = !credits ? 'muted' : credits.credits <= 0 ? 'critical' : credits.credits < LOW_CREDITS ? 'warning' : '';


  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <h1>admin</h1>
          <p className="page-sub">org-wide usage, team activity, and verifier credits.</p>
        </div>
      </header>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label"><RiFileList3Line size={15} aria-hidden="true" /> attempts</div>
          <div className="kpi-value">{num(o.totalVerifications)}</div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><RiCheckboxCircleLine size={15} aria-hidden="true" /> discovered</div>
          <div className="kpi-value">{num(o.totalDiscovered)}</div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><RiFlashlightLine size={15} aria-hidden="true" /> api calls</div>
          <div className="kpi-value">{num(o.totalApiCalls)}</div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><RiTeamLine size={15} aria-hidden="true" /> users</div>
          <div className="kpi-value">{num(o.distinctUsers)}</div>
        </div>

        <div className={`kpi kpi-credits ${creditTone}`} title={credits ? 'current balance' : 'couldn’t load the balance'}>
          <div className="kpi-label"><RiCoinsLine size={15} aria-hidden="true" /> millionverifier credits</div>
          <div className="kpi-value">{credits ? num(credits.credits) : '—'}</div>
          {(creditTone === 'warning' || creditTone === 'critical') && (
            <div className="kpi-foot">{creditTone === 'critical' ? 'out of credits. top up to keep verifying.' : 'running low'}</div>
          )}
        </div>
      </div>

      <UsageOverTime data={periodStats} />

      <TeamTable members={members} />

      <PaginatedTabs
        title={<><RiPulseLine size={16} aria-hidden="true" /> recent activity</>}
        className="activity-card"
        pageSize={10}
        emptyText="no activity yet."
        tabs={[
          {
            id: 'activity',
            label: 'recent activity',
            head: (
              <tr><th>when</th><th>user</th><th>email</th><th>type</th><th>status</th></tr>
            ),
            rows: o.recent.map((r) => (
              <tr key={r.id}>
                <td className="small" title={fullTime(r.created_at)}>{ago(r.created_at)}</td>
                <td className="small">{r.user_email}</td>
                <td className="mono">{r.email || '—'}</td>
                <td>
                  <span className="type-tag">{r.kind === 'find' ? 'discovery' : 'verification'}</span>
                  {r.source === 'bulk' && <span className="type-tag">bulk</span>}
                </td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            )),
          },
        ]}
      />
    </div>
  );
}

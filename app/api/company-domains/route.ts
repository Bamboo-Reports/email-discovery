import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BrandfetchSearchResult = {
  name?: string | null;
  domain?: string | null;
  icon?: string | null;
};

function cleanDomain(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) return NextResponse.json({ domains: [] });

  const clientId = process.env.BRANDFETCH_CLIENT_ID;
  if (!clientId) return NextResponse.json({ domains: [] });

  const url = new URL(`https://api.brandfetch.io/v2/search/${encodeURIComponent(q)}`);
  url.searchParams.set('c', clientId);

  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return NextResponse.json({ domains: [] });

    const data = (await res.json()) as BrandfetchSearchResult[];
    const seen = new Set<string>();
    const domains = data
      .map((item) => ({
        name: item.name?.trim() || '',
        domain: item.domain ? cleanDomain(item.domain) : '',
        icon: item.icon || '',
      }))
      .filter((item) => {
        if (!item.domain || seen.has(item.domain)) return false;
        seen.add(item.domain);
        return true;
      })
      .slice(0, 6);

    return NextResponse.json({ domains });
  } catch {
    return NextResponse.json({ domains: [] });
  }
}

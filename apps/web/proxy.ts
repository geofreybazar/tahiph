import { NextRequest, NextResponse } from 'next/server';
import { routeHost } from './lib/route-host';

export function proxy(request: NextRequest) {
  const route = routeHost(
    request.headers.get('host'),
    request.nextUrl.pathname,
    process.env.ROOT_DOMAIN ?? '',
  );

  if (route.kind === 'root') return NextResponse.next();
  if (route.kind === 'not-found') return new NextResponse('Not found', { status: 404 });

  const url = request.nextUrl.clone();
  url.pathname = route.rewriteTo;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|robots.txt|sitemap.xml).*)'],
};

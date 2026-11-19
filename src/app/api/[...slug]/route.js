import { NextResponse } from 'next/server';

function notFound(request) {
  return NextResponse.json(
    { success: false, error: 'NotFound', message: `Endpoint ${request.method} ${request.nextUrl.pathname} does not exist.` },
    { status: 404 }
  );
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };

import type { NextProxy } from "next/server";

const UPSTREAM = process.env.HOG_URL ?? "http://localhost:8787";

export const proxy: NextProxy = async (request) => {
  const { pathname, search } = request.nextUrl;
  const upstream = new URL(pathname + search, UPSTREAM);

  const headers = new Headers(request.headers);
  headers.set("host", upstream.host);
  headers.delete("transfer-encoding");

  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : request.body
        ? new Uint8Array(await request.arrayBuffer())
        : undefined;

  const upstreamResponse = await fetch(upstream, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  } as RequestInit);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
};

export const config = {
  matcher: "/api/:path*",
};

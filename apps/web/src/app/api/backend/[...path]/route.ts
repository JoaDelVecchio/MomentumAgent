export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BackendRouteContext = {
  params: Promise<{ path?: string[] }>;
};

const forwardedRequestHeaders = ["authorization", "content-type"] as const;

export async function GET(request: Request, context: BackendRouteContext) {
  return proxyBackendRequest(request, context);
}

export async function POST(request: Request, context: BackendRouteContext) {
  return proxyBackendRequest(request, context);
}

export async function PATCH(request: Request, context: BackendRouteContext) {
  return proxyBackendRequest(request, context);
}

export async function PUT(request: Request, context: BackendRouteContext) {
  return proxyBackendRequest(request, context);
}

async function proxyBackendRequest(request: Request, context: BackendRouteContext): Promise<Response> {
  const targetUrl = await buildBackendUrl(request, context);
  const init: RequestInit = {
    method: request.method,
    headers: headersForBackend(request),
    redirect: "manual"
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(targetUrl, init);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

async function buildBackendUrl(request: Request, context: BackendRouteContext): Promise<URL> {
  const { path = [] } = await context.params;
  const inboundUrl = new URL(request.url);
  const backendUrl = new URL(path.map(encodeURIComponent).join("/"), backendBaseUrl());
  backendUrl.search = inboundUrl.search;
  return backendUrl;
}

function backendBaseUrl(): string {
  const configured =
    process.env.MOMENTUM_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:3000";
  return configured.endsWith("/") ? configured : `${configured}/`;
}

function headersForBackend(request: Request): Headers {
  const headers = new Headers();

  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

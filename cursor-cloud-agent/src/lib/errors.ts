export function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function badRequest(message: string): Response {
  return errorResponse(message, 400);
}

export function notFound(message: string): Response {
  return errorResponse(message, 404);
}

export function serverError(message = "Internal server error"): Response {
  return errorResponse(message, 500);
}

export function safeErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    console.error(err);
    return fallback;
  }
  return fallback;
}

export async function parseJsonBody<T>(req: Request): Promise<T | Response> {
  try {
    return (await req.json()) as T;
  } catch {
    return badRequest("Invalid JSON body");
  }
}

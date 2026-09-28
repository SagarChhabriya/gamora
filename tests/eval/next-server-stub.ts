export function after(task: () => unknown) {
  void Promise.resolve().then(task);
}

export const NextResponse = { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) };

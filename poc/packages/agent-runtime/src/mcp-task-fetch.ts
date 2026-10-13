/**
 * Trusted MCP fetch boundary. A fresh, short-lived bearer is attached only to
 * the exact configured MCP endpoint; redirects cannot forward task credentials.
 *
 * This function is independent of ADK so its security behavior can be tested
 * without Gemini or any SDK transport.
 */
export function createTaskBearerFetch(
  endpointUrl: string,
  bearerForRequest: () => string,
  fetchFn: typeof fetch = fetch
): typeof fetch {
  const endpoint = new URL(endpointUrl);
  if (endpoint.pathname !== "/mcp" || endpoint.search || endpoint.hash ||
      endpoint.username || endpoint.password ||
      !(endpoint.protocol === "https:" ||
        (endpoint.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)))) {
    throw new Error("Shared MCP endpoint must be HTTPS or local-loopback HTTP /mcp");
  }
  return async (input, init) => {
    const requested = new URL(
      typeof input === "string" || input instanceof URL ? String(input) : input.url
    );
    if (requested.href !== endpoint.href) throw new Error("Unexpected shared MCP endpoint");
    const token = bearerForRequest();
    if (!token || !/^[A-Za-z0-9._-]+$/u.test(token)) {
      throw new Error("Missing or invalid private task bearer");
    }
    const headers = new Headers(init?.headers);
    headers.set("authorization", "Bearer " + token);
    return fetchFn(input, {...init, headers, redirect: "error"});
  };
}

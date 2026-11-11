/**
 * Publishes the Engineer's per-repository policy parameters to OPA as the
 * data document data.thesis.console_repositories (read by poc/opa/policy.rego).
 * Only parameters are written; the Rego rules themselves are never changed.
 */
import {repositoryUri, toOpaRepositoryConfig} from "./policy.mjs";

const PATH = "/v1/data/thesis/console_repositories";

/** JSON with object keys sorted (OPA returns documents with sorted keys). */
export function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  return JSON.stringify(value);
}

export function opaDocument(policies) {
  const document = {};
  for (const policy of policies)
    document[repositoryUri(policy.repository.owner, policy.repository.name)] =
      toOpaRepositoryConfig(policy);
  return document;
}

export class OpaPolicyPublisher {
  #url; #fetch;
  constructor({opaUrl, fetchFn = fetch}) { this.#url = opaUrl; this.#fetch = fetchFn; }

  async publish(policies) {
    const response = await this.#fetch(this.#url + PATH, {
      method: "PUT", headers: {"content-type": "application/json"},
      body: JSON.stringify(opaDocument(policies)), signal: AbortSignal.timeout(5000)
    });
    if (response.status !== 204 && response.status !== 200)
      throw Error("OPA ha rifiutato la pubblicazione della policy (HTTP " + response.status + ")");
  }

  /** True if OPA currently holds exactly the expected document. */
  async isCurrent(policies) {
    const response = await this.#fetch(this.#url + PATH, {signal: AbortSignal.timeout(3000)});
    if (!response.ok) return false;
    const body = await response.json();
    return canonicalJson(body.result ?? {}) === canonicalJson(opaDocument(policies));
  }
}

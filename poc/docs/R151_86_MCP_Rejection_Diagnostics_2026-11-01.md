# R151.86 — bounded MCP rejection diagnostics

## Evidence and scope

Paid run 41294807488 on R151.85 (8c8af9cfa771b5c8bf7230e92ee2508a1d0ec288)
observed 32 Gemini calls. Frontend recorded four failed reads and one failed write,
alongside four successful reads and one successful write. Test had zero calls.
The last observed error was read_file / invalid_tool_call. D1 consent was enabled,
but no verified Docker failure was reached. The artifact cannot identify which
specific validation rejected those historical calls. Root revocation and actual
provider invoice cost are not attested by that report.

This checkpoint adds diagnostic metadata only. Existing error kinds, HTTP status,
permission checks, task failure rules and D1 admission remain unchanged. No retry,
permission expansion, model-facing path restriction or paid dispatch is introduced.

## Diagnostic path

Private registry -> private HTTP worker -> shared MCP router/server -> ADK
read/update/create normalizers -> existing tool timing observation -> both existing
pilot sanitizers -> per-role `failed_operations` histogram.

The optional `reason` is independently allowlisted at boundaries:

- invalid_arguments: private request parser or shared catalog parser rejection;
- branch_mismatch: branch differs from the active approved Task;
- path_outside_signed_scope: path absent from that Task's allowed paths;
- operation_not_granted: missing exact operation/path grant or operation ceiling;
- gateway_prepare_rejected: non-5xx failed prepare response;
- upstream_unavailable: prepare transport/5xx or private-worker transport failure.

Reasons do not include paths, source, credentials, arbitrary messages or provider
payloads. Existing records without a reason and unsupported failure origins remain
`unclassified`; they are not retrospectively assigned a cause. SDK failures before
the server handler may still be unclassified. Counts describe observed failures,
not proof of causal responsibility or authorization to replay effects.

## Validation

102 focused tests passed with Node 22.15.0: private registry/HTTP, native shared MCP,
Gateway client, ADK adapter, read/write/create normalizers, shared MCP suite and
public pilot summarizer. A signed Frontend Task crosses the real shared MCP HTTP
server: invalid path syntax, wrong branch, unsigned path and absent write grant
are rejected; no rejected operation reaches the provider client; a legitimate read
still succeeds. Gateway 400/403/500/transport cases never proceed to execute.
Two-stage sanitizer tests preserve all per-tool categories and discard hostile
reason strings, source/path fields and raw content. Existing negative cases remain.
Static import and type-only contract audits pass. Remote CI is pending publication.

## Next decision

This does not prove the cause of run 41294807488 or fix generative Frontend behavior.
The historical sanitized artifact lacks rejected arguments and cannot be replayed
faithfully. Stop at this diagnostic checkpoint; select any behavioral correction
only from a reproducible failure or newly observed categorized evidence. A new
paid pilot needs separate authorization and same-SHA green CI; none was launched.

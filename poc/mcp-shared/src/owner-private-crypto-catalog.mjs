/**
 * Owner-selected cryptographic MCP operation names.
 *
 * Static trusted source code only. Neither an ADK/A2A model nor a remote
 * MCP client can register or extend this catalog.
 */
export const OWNER_PRIVATE_CRYPTO_OPERATIONS=Object.freeze({
  child_issue:Object.freeze({
    tool:"delegation_issue_child_owner_private",
    error:"Owner-private MCP child issuance unavailable"
  }),
  root_issue:Object.freeze({
    tool:"delegation_issue_root_owner_private",
    error:"Owner-private MCP root issuance unavailable"
  }),
  root_revoke:Object.freeze({
    tool:"delegation_revoke_root_owner_private",
    error:"Owner-private MCP root revocation unavailable"
  }),
  presentation_create:Object.freeze({
    tool:"delegation_create_presentation_owner_private",
    error:"Owner-private MCP presentation unavailable"
  })
});

package thesis.gateway_test

import rego.v1
import data.thesis.gateway.allow
import data.thesis.gateway.decision

repo_uri := "gitea://gitea.local/thesis/iam-console-poc"
feature_uri := "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension"
backend_file := "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts"
main_file := "gitea://gitea.local/thesis/iam-console-poc/branches/main/files/apps/backend/src/users/user.service.ts"

make_input(tool, resource, arguments) := {
	"request_id": "req-policy-1",
	"task_id": "task-policy-1",
	"agent_role": "backend",
	"tool": tool,
	"arguments": arguments,
	"required_permission": {
		"resource": resource,
		"operation": tool,
	},
	"repository": {
		"authority": "gitea.local",
		"owner": "thesis",
		"repository": "iam-console-poc",
	},
	"verified_delegation": {
		"presenter_id": "did:thesis:backend-agent",
		"credential_id": "urn:credential:backend",
		"issuer_id": "did:thesis:orchestrator",
		"hierarchy_depth": 1,
	},
}

test_allow_read_file_on_feature_branch if {
	allow with input as make_input(
		"read_file",
		backend_file,
		{"branch": "feature/account-suspension", "path": "apps/backend/src/users/user.service.ts"},
	)
}

test_allow_update_file_on_feature_branch if {
	allow with input as make_input(
		"update_file",
		backend_file,
		{
			"branch": "feature/account-suspension",
			"path": "apps/backend/src/users/user.service.ts",
			"content": "updated",
		},
	)
}

test_allow_create_file_on_feature_branch if {
	allow with input as make_input(
		"create_file",
		"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/tests/e2e/account-suspension.spec.ts",
		{
			"branch": "feature/account-suspension",
			"path": "tests/e2e/account-suspension.spec.ts",
			"content": "test",
		},
	)
}

test_deny_file_operation_on_main if {
	not allow with input as make_input(
		"update_file",
		main_file,
		{
			"branch": "main",
			"path": "apps/backend/src/users/user.service.ts",
			"content": "updated",
		},
	)
}

test_deny_read_file_outside_feature_branch if {
	not allow with input as make_input(
		"read_file",
		main_file,
		{"branch": "main", "path": "apps/backend/src/users/user.service.ts"},
	)
}

test_allow_exact_feature_branch_creation if {
	allow with input as make_input(
		"create_branch",
		repo_uri,
		{"base_branch": "main", "branch": "feature/account-suspension"},
	)
}

test_deny_branch_creation_from_non_main if {
	not allow with input as make_input(
		"create_branch",
		repo_uri,
		{"base_branch": "develop", "branch": "feature/account-suspension"},
	)
}

test_deny_creation_of_other_branch if {
	not allow with input as make_input(
		"create_branch",
		repo_uri,
		{"base_branch": "main", "branch": "feature/other"},
	)
}

test_allow_exact_pull_request_direction if {
	allow with input as make_input(
		"create_pull_request",
		repo_uri,
		{
			"head_branch": "feature/account-suspension",
			"base_branch": "main",
			"title": "Account suspension",
		},
	)
}

test_deny_reverse_pull_request_direction if {
	not allow with input as make_input(
		"create_pull_request",
		repo_uri,
		{
			"head_branch": "main",
			"base_branch": "feature/account-suspension",
			"title": "Wrong direction",
		},
	)
}

test_allow_run_tests_only_on_feature_branch_with_fixed_profile if {
	allow with input as make_input(
		"run_tests",
		feature_uri,
		{"branch": "feature/account-suspension", "profile": "poc-default"},
	)
}

test_deny_run_tests_on_main if {
	not allow with input as make_input(
		"run_tests",
		"gitea://gitea.local/thesis/iam-console-poc/branches/main",
		{"branch": "main", "profile": "poc-default"},
	)
}

test_deny_run_tests_with_arbitrary_profile if {
	not allow with input as make_input(
		"run_tests",
		feature_uri,
		{"branch": "feature/account-suspension", "profile": "arbitrary-shell"},
	)
}

test_deny_merge_pull_request_even_if_repository_is_controlled if {
	not allow with input as make_input(
		"merge_pull_request",
		repo_uri,
		{"pull_request": 1},
	)
}

test_deny_uncontrolled_repository if {
	base := make_input(
		"read_file",
		backend_file,
		{"branch": "feature/account-suspension", "path": "apps/backend/src/users/user.service.ts"},
	)
	bad := object.union(base, {
		"repository": {
			"authority": "gitea.local",
			"owner": "attacker",
			"repository": "iam-console-poc",
		},
	})
	not allow with input as bad
}

test_deny_without_verified_delegation_context if {
	base := make_input(
		"read_file",
		backend_file,
		{"branch": "feature/account-suspension", "path": "apps/backend/src/users/user.service.ts"},
	)
	bad := object.remove(base, {"verified_delegation"})
	not allow with input as bad
}

test_deny_operation_tool_mismatch if {
	base := make_input(
		"read_file",
		backend_file,
		{"branch": "feature/account-suspension", "path": "apps/backend/src/users/user.service.ts"},
	)
	bad := object.union(base, {
		"required_permission": {
			"resource": backend_file,
			"operation": "update_file",
		},
	})
	not allow with input as bad
}

test_decision_exposes_policy_version if {
	result := decision with input as make_input(
		"read_file",
		backend_file,
		{"branch": "feature/account-suspension", "path": "apps/backend/src/users/user.service.ts"},
	)
	result.allow == true
	result.policy_version == "authority-only-parametric-v3"
}

# Planning has read-only access to main only when the Orchestrator presents
# the explicitly scoped Rust Operation and canonical Gitea resource.
test_allow_orchestrator_repository_discovery if {
	base := make_input("read_repository", repo_uri, {})
	planning := object.union(base, {"agent_role": "orchestrator"})
	allow with input as planning
}

test_deny_backend_repository_discovery if {
	not allow with input as make_input("read_repository", repo_uri, {})
}

test_deny_repository_discovery_on_wrong_resource if {
	base := make_input("read_repository", feature_uri, {})
	planning := object.union(base, {"agent_role": "orchestrator"})
	not allow with input as planning
}

test_allow_orchestrator_main_directory_root if {
	base := make_input(
		"list_directory",
		"gitea://gitea.local/thesis/iam-console-poc/branches/main/directories",
		{"branch": "main", "path": ""},
	)
	planning := object.union(base, {"agent_role": "orchestrator"})
	allow with input as planning
}

test_allow_orchestrator_main_nested_directory if {
	base := make_input(
		"list_directory",
		"gitea://gitea.local/thesis/iam-console-poc/branches/main/directories/apps/backend",
		{"branch": "main", "path": "apps/backend"},
	)
	planning := object.union(base, {"agent_role": "orchestrator"})
	allow with input as planning
}

test_deny_backend_main_directory if {
	not allow with input as make_input(
		"list_directory",
		"gitea://gitea.local/thesis/iam-console-poc/branches/main/directories",
		{"branch": "main", "path": ""},
	)
}

test_allow_orchestrator_read_file_main if {
	base := make_input(
		"read_file",
		main_file,
		{"branch": "main", "path": "apps/backend/src/users/user.service.ts"},
	)
	planning := object.union(base, {"agent_role": "orchestrator"})
	allow with input as planning
}

test_deny_backend_read_file_main if {
	not allow with input as make_input(
		"read_file",
		main_file,
		{"branch": "main", "path": "apps/backend/src/users/user.service.ts"},
	)
}

test_allow_feature_branch_directory if {
	allow with input as make_input(
		"list_directory",
		sprintf("%s/directories/apps/backend", [feature_uri]),
		{"branch": "feature/account-suspension", "path": "apps/backend"},
	)
}

test_deny_directory_resource_on_unrelated_branch if {
	base := make_input(
		"list_directory",
		sprintf("%s/directories", [feature_uri]),
		{"branch": "main", "path": ""},
	)
	planning := object.union(base, {"agent_role": "orchestrator"})
	not allow with input as planning
}

test_deny_orchestrator_write_on_main_even_with_valid_delegation if {
	base := make_input(
		"update_file",
		main_file,
		{"branch": "main", "path": "apps/backend/src/users/user.service.ts"},
	)
	planning := object.union(base, {"agent_role": "orchestrator"})
	not allow with input as planning
}


approved_feature_branch := "feature/engineer-approved-42"
approved_file := "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fengineer-approved-42/files/apps/backend/src/users/user.service.ts"
approved_test_uri := "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fengineer-approved-42"
trusted_approval := {"approved_plan_digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approved_work_branch": approved_feature_branch}

test_allow_signed_dynamic_branch_file_update if {
  base := make_input("update_file",approved_file,
    {"branch":approved_feature_branch,"path":"apps/backend/src/users/user.service.ts"})
  allow with input as object.union(base,trusted_approval)
}
test_allow_signed_dynamic_branch_creation if {
  base := make_input("create_branch",repo_uri,
    {"base_branch":"main","branch":approved_feature_branch})
  allow with input as object.union(base,trusted_approval)
}
test_allow_signed_dynamic_branch_runner if {
  base := make_input("run_tests",approved_test_uri,
    {"branch":approved_feature_branch,"profile":"poc-default"})
  allow with input as object.union(base,trusted_approval)
}
test_deny_unapproved_dynamic_branch_without_gateway_binding if {
  base := make_input("update_file",approved_file,
    {"branch":approved_feature_branch,"path":"apps/backend/src/users/user.service.ts"})
  not allow with input as base
}
test_deny_spoofed_dynamic_branch_digest if {
  base := make_input("update_file",approved_file,
    {"branch":approved_feature_branch,"path":"apps/backend/src/users/user.service.ts"})
  bad := object.union(base,{
    "approved_plan_digest":"forged","approved_work_branch":approved_feature_branch
  })
  not allow with input as bad
}
test_deny_approved_branch_mismatch_on_main_and_other_feature if {
  base := make_input("create_branch",repo_uri,
    {"base_branch":"main","branch":"feature/attacker"})
  not allow with input as object.union(base,trusted_approval)
  from_main := make_input("update_file",main_file,{
    "branch":"main","path":"apps/backend/src/users/user.service.ts"
  })
  not allow with input as object.union(from_main,trusted_approval)
}
test_deny_approved_branch_traversal_and_invalid_profile if {
  base := make_input("create_branch",repo_uri,
    {"base_branch":"main","branch":"feature/a..b"})
  bad := object.union(base,{
    "approved_plan_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "approved_work_branch":"feature/a..b"
  })
  not allow with input as bad
  tests := make_input("run_tests",approved_test_uri,
    {"branch":approved_feature_branch,"profile":"uncontrolled-shell"})
  not allow with input as object.union(tests,trusted_approval)
}

# R454: OPA may evaluate a new signed specialist read (the native Gateway
# separately authenticates the role/Child and exact read-only Task). A model
# or A2A Card cannot use that role name to gain writes, Runner or PR power.
test_additional_specialist_signed_source_read_allowed if {
 base := make_input("read_file",backend_file,
  {"branch":"feature/account-suspension","path":"apps/backend/src/users/user.service.ts"})
 reviewer := object.union(base,{
  "agent_role":"reviewer",
  "verified_delegation":object.union(base.verified_delegation,{
   "presenter_id":"did:thesis:reviewer-agent"
  })
 })
 allow with input as reviewer
}

test_additional_specialist_cannot_use_nonread_provider_ops if {
 every action in ["update_file","create_file","run_tests","create_branch","create_pull_request"] {
  args := {"branch":"feature/account-suspension","path":"apps/backend/src/users/user.service.ts","content":"forbidden"}
  base := make_input(action,backend_file,args)
  reviewer := object.union(base,{"agent_role":"reviewer"})
  not allow with input as reviewer
 }
}

# R457: an additional Child is permitted to sign only a single read_file
# grant. OPA must not independently admit a feature-branch directory walk,
# even if a forged VP payload appears well formed to the policy engine.
test_additional_specialist_cannot_list_directory if {
 base := make_input(
  "list_directory",
  sprintf("%s/directories/apps/backend", [feature_uri]),
  {"branch":"feature/account-suspension","path":"apps/backend"}
 )
 reviewer := object.union(base,{
  "agent_role":"reviewer",
  "verified_delegation":object.union(base.verified_delegation,{
   "presenter_id":"did:thesis:reviewer-agent"
  })
 })
 not allow with input as reviewer
}

test_original_specialist_can_still_list_approved_directory if {
 allow with input as make_input(
  "list_directory",
  sprintf("%s/directories/apps/backend", [feature_uri]),
  {"branch":"feature/account-suspension","path":"apps/backend"}
 )
}

# ---------------------------------------------------------------------------
# Parametric repositories published by the Engineer console.
# ---------------------------------------------------------------------------
console_repos := {"gitea://gitea.local/thesis/shop": {
	"base_branch": "master",
	"protected_branches": ["master", "release"],
	"work_branch_prefix": "agent/",
	"forbidden_path_prefixes": [".github/", "security/"],
	"runner_profile": "node-default",
	"allow_pull_request": true,
}}

shop_repo := "gitea://gitea.local/thesis/shop"
shop_branch := "agent/session-7"
shop_branch_uri := "gitea://gitea.local/thesis/shop/branches/agent%2Fsession-7"

shop_input(tool, resource, arguments, session_branch) := object.union(
	object.union(make_input(tool, resource, arguments), {"repository": {
		"authority": "gitea.local", "owner": "thesis", "repository": "shop",
	}}),
	{"session_work_branch": session_branch},
)

test_console_repo_allows_signed_session_branch_update if {
	allow with input as shop_input("update_file", sprintf("%s/files/src/app.js", [shop_branch_uri]),
		{"branch": shop_branch, "path": "src/app.js"}, shop_branch)
		with data.thesis.console_repositories as console_repos
}

test_console_repo_uses_configured_base_branch_for_branch_and_pr if {
	allow with input as shop_input("create_branch", shop_repo,
		{"base_branch": "master", "branch": shop_branch}, shop_branch)
		with data.thesis.console_repositories as console_repos
	not allow with input as shop_input("create_branch", shop_repo,
		{"base_branch": "main", "branch": shop_branch}, shop_branch)
		with data.thesis.console_repositories as console_repos
	allow with input as shop_input("create_pull_request", shop_repo,
		{"head_branch": shop_branch, "base_branch": "master"}, shop_branch)
		with data.thesis.console_repositories as console_repos
}

test_console_repo_denies_branch_other_than_signed_session if {
	not allow with input as shop_input("update_file",
		"gitea://gitea.local/thesis/shop/branches/agent%2Fother/files/src/app.js",
		{"branch": "agent/other", "path": "src/app.js"}, shop_branch)
		with data.thesis.console_repositories as console_repos
}

test_console_repo_denies_session_branch_that_is_protected_or_malformed if {
	every bad in ["master", "release", "feature/x", "agent/../master", "agent/a//b", "agent/x.lock", "agent/"] {
		not allow with input as shop_input("create_branch", shop_repo,
			{"base_branch": "master", "branch": bad}, bad)
			with data.thesis.console_repositories as console_repos
	}
}

test_console_repo_forbidden_paths_block_writes_but_not_reads if {
	every tool in ["update_file", "create_file"] {
		not allow with input as shop_input(tool, sprintf("%s/files/security/keys.ts", [shop_branch_uri]),
			{"branch": shop_branch, "path": "security/keys.ts"}, shop_branch)
			with data.thesis.console_repositories as console_repos
		not allow with input as shop_input(tool, sprintf("%s/files/.github/workflows/ci.yml", [shop_branch_uri]),
			{"branch": shop_branch, "path": ".github/workflows/ci.yml"}, shop_branch)
			with data.thesis.console_repositories as console_repos
	}
	allow with input as shop_input("read_file", sprintf("%s/files/security/keys.ts", [shop_branch_uri]),
		{"branch": shop_branch, "path": "security/keys.ts"}, shop_branch)
		with data.thesis.console_repositories as console_repos
}

test_console_repo_runner_profile_and_pr_switch if {
	allow with input as shop_input("run_tests", shop_branch_uri,
		{"branch": shop_branch, "profile": "node-default"}, shop_branch)
		with data.thesis.console_repositories as console_repos
	not allow with input as shop_input("run_tests", shop_branch_uri,
		{"branch": shop_branch, "profile": "poc-default"}, shop_branch)
		with data.thesis.console_repositories as console_repos
	no_pr := {shop_repo: object.union(console_repos[shop_repo], {"allow_pull_request": false})}
	not allow with input as shop_input("create_pull_request", shop_repo,
		{"head_branch": shop_branch, "base_branch": "master"}, shop_branch)
		with data.thesis.console_repositories as no_pr
}

test_console_repo_planning_reads_only_its_base_branch if {
	base := shop_input("read_file", "gitea://gitea.local/thesis/shop/branches/master/files/src/app.js",
		{"branch": "master", "path": "src/app.js"}, null)
	orchestrator := object.union(base, {"agent_role": "orchestrator"})
	planning := object.remove(orchestrator, ["session_work_branch"])
	allow with input as planning with data.thesis.console_repositories as console_repos
	write := object.union(planning, {"tool": "update_file",
		"required_permission": {"resource": "gitea://gitea.local/thesis/shop/branches/master/files/src/app.js",
			"operation": "update_file"}})
	not allow with input as write with data.thesis.console_repositories as console_repos
}

test_unconfigured_repository_is_denied if {
	other := object.union(make_input("read_file",
		"gitea://gitea.local/thesis/unknown/branches/agent%2Fx/files/a.js",
		{"branch": "agent/x", "path": "a.js"}), {"repository": {
		"authority": "gitea.local", "owner": "thesis", "repository": "unknown"},
		"session_work_branch": "agent/x"})
	not allow with input as other with data.thesis.console_repositories as console_repos
}

test_console_config_overrides_builtin_for_same_repository if {
	override := {repo_uri: {
		"base_branch": "main", "protected_branches": ["main"], "work_branch_prefix": "agent/",
		"forbidden_path_prefixes": [], "runner_profile": "poc-default", "allow_pull_request": true,
	}}
	not allow with input as make_input("read_file", backend_file,
		{"branch": "feature/account-suspension", "path": "apps/backend/src/users/user.service.ts"})
		with data.thesis.console_repositories as override
}

test_allow_new_specialists_update_on_feature_branch if {
	every role in ["docs", "data", "devops"] {
		allow with input as object.union(make_input(
			"update_file",
			"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/README.md",
			{"branch": "feature/account-suspension", "path": "README.md", "content": "updated"},
		), {"agent_role": role})
	}
}

test_deny_write_by_unknown_role if {
	not allow with input as object.union(make_input(
		"update_file",
		backend_file,
		{"branch": "feature/account-suspension", "path": "apps/backend/src/users/user.service.ts", "content": "x"},
	), {"agent_role": "reviewer"})
}

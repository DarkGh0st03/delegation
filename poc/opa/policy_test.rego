package thesis.gateway_test

import rego.v1
import data.thesis.gateway.allow
import data.thesis.gateway.decision

repo_uri := "gitea://gitea.local/thesis/sample-app"
feature_uri := "gitea://gitea.local/thesis/sample-app/branches/feature%2Fsession-work"
backend_file := "gitea://gitea.local/thesis/sample-app/branches/feature%2Fsession-work/files/apps/backend/src/users/user.service.ts"
main_file := "gitea://gitea.local/thesis/sample-app/branches/main/files/apps/backend/src/users/user.service.ts"

# Parameters the console would publish for the default test repository.
default_repos := {repo_uri: {
	"base_branch": "main",
	"protected_branches": ["main"],
	"work_branch_prefix": "feature/",
	"forbidden_path_prefixes": [],
	"runner_profile": "poc-default",
	"allow_pull_request": true,
}}

make_input(tool, resource, arguments) := {
	"request_id": "req-policy-1",
	"session_work_branch": "feature/session-work",
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
		"repository": "sample-app",
	},
	"verified_delegation": {
		"presenter_id": "did:thesis:backend-agent",
		"credential_id": "urn:credential:backend",
		"issuer_id": "did:thesis:orchestrator",
		"hierarchy_depth": 1,
	},
}

# The Orchestrator presents its Root DC: delegation depth 0.
as_orchestrator(x) := object.union(x, {"agent_role": "orchestrator", "verified_delegation": {"hierarchy_depth": 0}})

with_depth(x, d) := object.union(x, {"verified_delegation": {"hierarchy_depth": d}})

test_allow_read_file_on_feature_branch if {
	allow with input as make_input(
		"read_file",
		backend_file,
		{"branch": "feature/session-work", "path": "apps/backend/src/users/user.service.ts"},
	) with data.thesis.console_repositories as default_repos
}

test_allow_update_file_on_feature_branch if {
	allow with input as make_input(
		"update_file",
		backend_file,
		{
			"branch": "feature/session-work",
			"path": "apps/backend/src/users/user.service.ts",
			"content": "updated",
		},
	) with data.thesis.console_repositories as default_repos
}

test_allow_create_file_on_feature_branch if {
	allow with input as make_input(
		"create_file",
		"gitea://gitea.local/thesis/sample-app/branches/feature%2Fsession-work/files/tests/e2e/sample-change.spec.ts",
		{
			"branch": "feature/session-work",
			"path": "tests/e2e/sample-change.spec.ts",
			"content": "test",
		},
	) with data.thesis.console_repositories as default_repos
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
	) with data.thesis.console_repositories as default_repos
}

test_deny_read_file_outside_feature_branch if {
	not allow with input as make_input(
		"read_file",
		main_file,
		{"branch": "main", "path": "apps/backend/src/users/user.service.ts"},
	) with data.thesis.console_repositories as default_repos
}

test_allow_exact_feature_branch_creation if {
	allow with input as make_input(
		"create_branch",
		repo_uri,
		{"base_branch": "main", "branch": "feature/session-work"},
	) with data.thesis.console_repositories as default_repos
}

test_deny_branch_creation_from_non_main if {
	not allow with input as make_input(
		"create_branch",
		repo_uri,
		{"base_branch": "develop", "branch": "feature/session-work"},
	) with data.thesis.console_repositories as default_repos
}

test_deny_creation_of_other_branch if {
	not allow with input as make_input(
		"create_branch",
		repo_uri,
		{"base_branch": "main", "branch": "feature/other"},
	) with data.thesis.console_repositories as default_repos
}

test_allow_exact_pull_request_direction if {
	allow with input as make_input(
		"create_pull_request",
		repo_uri,
		{
			"head_branch": "feature/session-work",
			"base_branch": "main",
			"title": "User export",
		},
	) with data.thesis.console_repositories as default_repos
}

test_deny_reverse_pull_request_direction if {
	not allow with input as make_input(
		"create_pull_request",
		repo_uri,
		{
			"head_branch": "main",
			"base_branch": "feature/session-work",
			"title": "Wrong direction",
		},
	) with data.thesis.console_repositories as default_repos
}

test_allow_run_tests_only_on_feature_branch_with_fixed_profile if {
	allow with input as make_input(
		"run_tests",
		feature_uri,
		{"branch": "feature/session-work", "profile": "poc-default"},
	) with data.thesis.console_repositories as default_repos
}

test_deny_run_tests_on_main if {
	not allow with input as make_input(
		"run_tests",
		"gitea://gitea.local/thesis/sample-app/branches/main",
		{"branch": "main", "profile": "poc-default"},
	) with data.thesis.console_repositories as default_repos
}

test_deny_run_tests_with_arbitrary_profile if {
	not allow with input as make_input(
		"run_tests",
		feature_uri,
		{"branch": "feature/session-work", "profile": "arbitrary-shell"},
	) with data.thesis.console_repositories as default_repos
}

test_deny_merge_pull_request_even_if_repository_is_controlled if {
	not allow with input as make_input(
		"merge_pull_request",
		repo_uri,
		{"pull_request": 1},
	) with data.thesis.console_repositories as default_repos
}

test_deny_uncontrolled_repository if {
	base := make_input(
		"read_file",
		backend_file,
		{"branch": "feature/session-work", "path": "apps/backend/src/users/user.service.ts"},
	)
	bad := object.union(base, {
		"repository": {
			"authority": "gitea.local",
			"owner": "attacker",
			"repository": "sample-app",
		},
	})
	not allow with input as bad with data.thesis.console_repositories as default_repos
}

test_deny_without_verified_delegation_context if {
	base := make_input(
		"read_file",
		backend_file,
		{"branch": "feature/session-work", "path": "apps/backend/src/users/user.service.ts"},
	)
	bad := object.remove(base, {"verified_delegation"})
	not allow with input as bad with data.thesis.console_repositories as default_repos
}

test_deny_operation_tool_mismatch if {
	base := make_input(
		"read_file",
		backend_file,
		{"branch": "feature/session-work", "path": "apps/backend/src/users/user.service.ts"},
	)
	bad := object.union(base, {
		"required_permission": {
			"resource": backend_file,
			"operation": "update_file",
		},
	})
	not allow with input as bad with data.thesis.console_repositories as default_repos
}

test_decision_exposes_policy_version if {
	result := decision with input as make_input(
		"read_file",
		backend_file,
		{"branch": "feature/session-work", "path": "apps/backend/src/users/user.service.ts"},
	) with data.thesis.console_repositories as default_repos
	result.allow == true
	result.policy_version == "authority-only-parametric-v5"
}

# Planning has read-only access to main only when the Orchestrator presents
# the explicitly scoped Rust Operation and canonical Gitea resource.
test_allow_orchestrator_repository_discovery if {
	base := make_input("read_repository", repo_uri, {})
	planning := as_orchestrator(base)
	allow with input as planning with data.thesis.console_repositories as default_repos
}

test_deny_backend_repository_discovery if {
	not allow with input as make_input("read_repository", repo_uri, {}) with data.thesis.console_repositories as default_repos
}

test_deny_repository_discovery_on_wrong_resource if {
	base := make_input("read_repository", feature_uri, {})
	planning := as_orchestrator(base)
	not allow with input as planning with data.thesis.console_repositories as default_repos
}

test_allow_orchestrator_main_directory_root if {
	base := make_input(
		"list_directory",
		"gitea://gitea.local/thesis/sample-app/branches/main/directories",
		{"branch": "main", "path": ""},
	)
	planning := as_orchestrator(base)
	allow with input as planning with data.thesis.console_repositories as default_repos
}

test_allow_orchestrator_main_nested_directory if {
	base := make_input(
		"list_directory",
		"gitea://gitea.local/thesis/sample-app/branches/main/directories/apps/backend",
		{"branch": "main", "path": "apps/backend"},
	)
	planning := as_orchestrator(base)
	allow with input as planning with data.thesis.console_repositories as default_repos
}

test_deny_backend_main_directory if {
	not allow with input as make_input(
		"list_directory",
		"gitea://gitea.local/thesis/sample-app/branches/main/directories",
		{"branch": "main", "path": ""},
	) with data.thesis.console_repositories as default_repos
}

test_allow_orchestrator_read_file_main if {
	base := make_input(
		"read_file",
		main_file,
		{"branch": "main", "path": "apps/backend/src/users/user.service.ts"},
	)
	planning := as_orchestrator(base)
	allow with input as planning with data.thesis.console_repositories as default_repos
}

test_deny_backend_read_file_main if {
	not allow with input as make_input(
		"read_file",
		main_file,
		{"branch": "main", "path": "apps/backend/src/users/user.service.ts"},
	) with data.thesis.console_repositories as default_repos
}

test_allow_feature_branch_directory if {
	allow with input as make_input(
		"list_directory",
		sprintf("%s/directories/apps/backend", [feature_uri]),
		{"branch": "feature/session-work", "path": "apps/backend"},
	) with data.thesis.console_repositories as default_repos
}

test_deny_directory_resource_on_unrelated_branch if {
	base := make_input(
		"list_directory",
		sprintf("%s/directories", [feature_uri]),
		{"branch": "main", "path": ""},
	)
	planning := as_orchestrator(base)
	not allow with input as planning with data.thesis.console_repositories as default_repos
}

test_deny_orchestrator_write_on_main_even_with_valid_delegation if {
	base := make_input(
		"update_file",
		main_file,
		{"branch": "main", "path": "apps/backend/src/users/user.service.ts"},
	)
	planning := as_orchestrator(base)
	not allow with input as planning with data.thesis.console_repositories as default_repos
}


# R454: OPA may evaluate a new signed specialist read (the native Gateway
# separately authenticates the role/Child and exact read-only Task). A model
# or A2A Card cannot use that role name to gain writes, Runner or PR power.
test_additional_specialist_signed_source_read_allowed if {
 base := make_input("read_file",backend_file,
  {"branch":"feature/session-work","path":"apps/backend/src/users/user.service.ts"})
 reviewer := object.union(base,{
  "agent_role":"reviewer",
  "verified_delegation":object.union(base.verified_delegation,{
   "presenter_id":"did:thesis:reviewer-agent"
  })
 })
 allow with input as reviewer with data.thesis.console_repositories as default_repos
}

test_additional_specialist_cannot_use_nonread_provider_ops if {
 every action in ["update_file","create_file","run_tests","create_branch","create_pull_request"] {
  args := {"branch":"feature/session-work","path":"apps/backend/src/users/user.service.ts","content":"forbidden"}
  base := make_input(action,backend_file,args)
  reviewer := object.union(base,{"agent_role":"reviewer"})
  not allow with input as reviewer with data.thesis.console_repositories as default_repos
 }
}

# R457: an additional Child is permitted to sign only a single read_file
# grant. OPA must not independently admit a feature-branch directory walk,
# even if a forged VP payload appears well formed to the policy engine.
test_additional_specialist_cannot_list_directory if {
 base := make_input(
  "list_directory",
  sprintf("%s/directories/apps/backend", [feature_uri]),
  {"branch":"feature/session-work","path":"apps/backend"}
 )
 reviewer := object.union(base,{
  "agent_role":"reviewer",
  "verified_delegation":object.union(base.verified_delegation,{
   "presenter_id":"did:thesis:reviewer-agent"
  })
 })
 not allow with input as reviewer with data.thesis.console_repositories as default_repos
}

test_original_specialist_can_still_list_approved_directory if {
 allow with input as make_input(
  "list_directory",
  sprintf("%s/directories/apps/backend", [feature_uri]),
  {"branch":"feature/session-work","path":"apps/backend"}
 ) with data.thesis.console_repositories as default_repos
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
	orchestrator := as_orchestrator(base)
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

test_allow_new_specialists_update_on_feature_branch if {
	every role in ["docs", "data", "devops"] {
		allow with input as object.union(make_input(
			"update_file",
			"gitea://gitea.local/thesis/sample-app/branches/feature%2Fsession-work/files/README.md",
			{"branch": "feature/session-work", "path": "README.md", "content": "updated"},
		), {"agent_role": role}) with data.thesis.console_repositories as default_repos
	}
}

test_deny_write_by_unknown_role if {
	not allow with input as object.union(make_input(
		"update_file",
		backend_file,
		{"branch": "feature/session-work", "path": "apps/backend/src/users/user.service.ts", "content": "x"},
	), {"agent_role": "reviewer"}) with data.thesis.console_repositories as default_repos
}

test_deny_writes_without_signed_session_branch if {
	base := object.remove(make_input("update_file", backend_file,
		{"branch": "feature/session-work", "path": "apps/backend/src/users/user.service.ts"}),
		["session_work_branch"])
	not allow with input as base with data.thesis.console_repositories as default_repos
}

test_deny_unconfigured_default_repository if {
	not allow with input as make_input("read_file", backend_file,
		{"branch": "feature/session-work", "path": "apps/backend/src/users/user.service.ts"})
}

# --- Delegation depth: Root DC (0) for the Orchestrator, Child DC (1) for specialists ---

specialist_read := make_input(
	"read_file",
	backend_file,
	{"branch": "feature/session-work", "path": "apps/backend/src/users/user.service.ts"},
)

orchestrator_planning_read := as_orchestrator(make_input(
	"read_file",
	main_file,
	{"branch": "main", "path": "apps/backend/src/users/user.service.ts"},
))

test_allow_specialist_with_child_depth_1 if {
	allow with input as with_depth(specialist_read, 1) with data.thesis.console_repositories as default_repos
}

test_deny_specialist_presenting_root_depth_0 if {
	not allow with input as with_depth(specialist_read, 0) with data.thesis.console_repositories as default_repos
}

test_deny_specialist_with_sub_delegated_depth_2 if {
	not allow with input as with_depth(specialist_read, 2) with data.thesis.console_repositories as default_repos
}

test_allow_orchestrator_with_root_depth_0 if {
	allow with input as with_depth(orchestrator_planning_read, 0) with data.thesis.console_repositories as default_repos
}

test_deny_orchestrator_presenting_child_depth_1 if {
	not allow with input as with_depth(orchestrator_planning_read, 1) with data.thesis.console_repositories as default_repos
}

test_deny_orchestrator_with_depth_2 if {
	not allow with input as with_depth(orchestrator_planning_read, 2) with data.thesis.console_repositories as default_repos
}

test_deny_test_agent_with_depth_2 if {
	test_input := object.union(specialist_read, {"agent_role": "test"})
	not allow with input as with_depth(test_input, 2) with data.thesis.console_repositories as default_repos
}

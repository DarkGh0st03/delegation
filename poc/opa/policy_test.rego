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
	result.policy_version == "phase4a-v1"
}

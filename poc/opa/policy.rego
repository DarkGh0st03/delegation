package thesis.gateway

import rego.v1

default allow := false

policy_version := "authority-only-parametric-v3"

# ---------------------------------------------------------------------------
# Per-repository parameters.
#
# The Engineer console publishes data.thesis.console_repositories, keyed by
# the canonical repository URI. The built-in entry keeps the original
# Account Suspension fixture working when no console parameters exist (CI
# and the scripted native E2E). Parameters never come from tool arguments.
# ---------------------------------------------------------------------------
builtin_repositories := {"gitea://gitea.local/thesis/iam-console-poc": {
	"base_branch": "main",
	"protected_branches": ["main"],
	"work_branch_prefix": "feature/",
	"default_work_branch": "feature/account-suspension",
	"forbidden_path_prefixes": [],
	"runner_profile": "poc-default",
	"allow_pull_request": true,
}}

repository_uri := sprintf("gitea://%s/%s/%s", [
	input.repository.authority,
	input.repository.owner,
	input.repository.repository,
])

repo_config := data.thesis.console_repositories[repository_uri]

repo_config := builtin_repositories[repository_uri] if {
	not data.thesis.console_repositories[repository_uri]
}

controlled_repository if {
	is_object(repo_config)
	is_string(repo_config.base_branch)
	is_string(repo_config.work_branch_prefix)
	is_string(repo_config.runner_profile)
}

base_branch := repo_config.base_branch

branch_uri(branch) := sprintf("%s/branches/%s", [repository_uri, replace(branch, "/", "%2F")])

# A work branch is acceptable only if it has the configured prefix, a safe
# shape and is not a protected branch.
valid_work_branch(branch) if {
	is_string(branch)
	startswith(branch, repo_config.work_branch_prefix)
	suffix := substring(branch, count(repo_config.work_branch_prefix), -1)
	regex.match("^[a-z0-9][a-z0-9._/-]*$", suffix)
	not contains(branch, "..")
	not contains(branch, "//")
	not endswith(branch, ".lock")
	not endswith(branch, ".")
	not endswith(branch, "/")
	not branch in repo_config.protected_branches
}

# The effective work branch, in order of trust:
# 1. session_work_branch: injected by the Gateway from the Engineer-signed
#    operational authority of the live session (authority-only path);
# 2. approved_work_branch with its plan digest (historical signed-DAG path);
# 3. the repository's fixed default work branch, if configured.
work_branch := input.session_work_branch if {
	valid_work_branch(input.session_work_branch)
}

work_branch := input.approved_work_branch if {
	not input.session_work_branch
	is_string(input.approved_plan_digest)
	regex.match("^[a-f0-9]{64}$", input.approved_plan_digest)
	valid_work_branch(input.approved_work_branch)
}

work_branch := repo_config.default_work_branch if {
	not input.session_work_branch
	not input.approved_plan_digest
	not input.approved_work_branch
	valid_work_branch(repo_config.default_work_branch)
}

work_branch_uri := branch_uri(work_branch)

original_agent_role if {
	input.agent_role in {"backend", "frontend", "test", "orchestrator"}
}

verified_context if {
	is_object(input.verified_delegation)
	is_string(input.verified_delegation.presenter_id)
	input.verified_delegation.presenter_id != ""
	is_string(input.verified_delegation.credential_id)
	input.verified_delegation.credential_id != ""
	is_number(input.verified_delegation.hierarchy_depth)
	input.verified_delegation.hierarchy_depth >= 0
}

bound_request_context if {
	is_string(input.request_id)
	input.request_id != ""
	is_string(input.task_id)
	input.task_id != ""
	is_string(input.agent_role)
	input.agent_role != ""
	is_string(input.tool)
	is_object(input.arguments)
	is_object(input.required_permission)
	input.required_permission.operation == input.tool
	controlled_repository
	verified_context
}

file_operation_on_work_branch if {
	input.arguments.branch == work_branch
	startswith(input.required_permission.resource, sprintf("%s/files/", [work_branch_uri]))
}

# Paths the agents may never modify (read access is not affected).
forbidden_path if {
	some prefix in repo_config.forbidden_path_prefixes
	startswith(input.arguments.path, prefix)
}

# Read-only discovery of a controlled repository: only the Orchestrator,
# and only when a VP contains the exact read_repository permission.
allow if {
	bound_request_context
	input.tool == "read_repository"
	input.agent_role == "orchestrator"
	input.required_permission.resource == repository_uri
	count(object.keys(input.arguments)) == 0
}

# Planning before approval: read the base branch, but never modify it.
allow if {
	bound_request_context
	input.tool == "read_file"
	input.agent_role == "orchestrator"
	input.arguments.branch == base_branch
	startswith(input.required_permission.resource, sprintf("%s/files/", [branch_uri(base_branch)]))
}

directory_permission(prefix) if {
	input.required_permission.resource == prefix
}

directory_permission(prefix) if {
	startswith(input.required_permission.resource, sprintf("%s/", [prefix]))
}

allow if {
	bound_request_context
	input.tool == "list_directory"
	input.agent_role == "orchestrator"
	input.arguments.branch == base_branch
	directory_permission(sprintf("%s/directories", [branch_uri(base_branch)]))
}

allow if {
	bound_request_context
	original_agent_role
	input.tool == "list_directory"
	input.arguments.branch == work_branch
	directory_permission(sprintf("%s/directories", [work_branch_uri]))
}

allow if {
	bound_request_context
	input.tool == "read_file"
	file_operation_on_work_branch
}

allow if {
	bound_request_context
	original_agent_role
	input.tool == "update_file"
	file_operation_on_work_branch
	not forbidden_path
}

allow if {
	bound_request_context
	original_agent_role
	input.tool == "create_file"
	file_operation_on_work_branch
	not forbidden_path
}

allow if {
	bound_request_context
	original_agent_role
	input.tool == "create_branch"
	input.required_permission.resource == repository_uri
	input.arguments.base_branch == base_branch
	input.arguments.branch == work_branch
}

allow if {
	bound_request_context
	original_agent_role
	input.tool == "create_pull_request"
	repo_config.allow_pull_request == true
	input.required_permission.resource == repository_uri
	input.arguments.head_branch == work_branch
	input.arguments.base_branch == base_branch
}

allow if {
	bound_request_context
	original_agent_role
	input.tool == "run_tests"
	input.required_permission.resource == work_branch_uri
	input.arguments.branch == work_branch
	input.arguments.profile == repo_config.runner_profile
}

decision := {
	"allow": allow,
	"policy_version": policy_version,
}

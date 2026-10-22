package thesis.gateway

import rego.v1

default allow := false

policy_version := "phase6-approved-branch-v2"

feature_branch := "feature/account-suspension"
main_branch := "main"
repository_uri := "gitea://gitea.local/thesis/iam-console-poc"
feature_branch_uri := "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension"

# A nonlegacy branch is possible only when Gateway has installed a signed
# Engineer plan and passed its immutable digest AND trusted derived branch.
# These are server-injected by Gateway, never accepted as tool arguments.
effective_feature_branch := feature_branch if {
  not input.approved_plan_digest
  not input.approved_work_branch
}
effective_feature_branch := input.approved_work_branch if {
  is_string(input.approved_plan_digest)
  regex.match("^[a-f0-9]{64}$", input.approved_plan_digest)
  is_string(input.approved_work_branch)
  regex.match("^feature/[a-z0-9][a-z0-9./_-]*$", input.approved_work_branch)
  not contains(input.approved_work_branch, "..")
  not contains(input.approved_work_branch, "//")
  not endswith(input.approved_work_branch, ".lock")
  not endswith(input.approved_work_branch, ".")
}
effective_feature_uri := sprintf("%s/branches/%s",[
  repository_uri,replace(effective_feature_branch,"/","%2F")
])

controlled_repository if {
	input.repository.authority == "gitea.local"
	input.repository.owner == "thesis"
	input.repository.repository == "iam-console-poc"
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

file_operation_on_feature_branch if {
	input.arguments.branch == effective_feature_branch
	startswith(input.required_permission.resource, sprintf("%s/files/", [effective_feature_uri]))
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

# Planning before approval: read main, but never modify main.
allow if {
	bound_request_context
	input.tool == "read_file"
	input.agent_role == "orchestrator"
	input.arguments.branch == main_branch
	startswith(input.required_permission.resource, sprintf("%s/branches/main/files/", [repository_uri]))
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
	input.arguments.branch == main_branch
	directory_permission(sprintf("%s/branches/main/directories", [repository_uri]))
}

allow if {
	bound_request_context
	input.tool == "list_directory"
	input.arguments.branch == effective_feature_branch
	directory_permission(sprintf("%s/directories", [effective_feature_uri]))
}

allow if {
	bound_request_context
	input.tool == "read_file"
	file_operation_on_feature_branch
}

allow if {
	bound_request_context
	input.tool == "update_file"
	file_operation_on_feature_branch
}

allow if {
	bound_request_context
	input.tool == "create_file"
	file_operation_on_feature_branch
}

allow if {
	bound_request_context
	input.tool == "create_branch"
	input.required_permission.resource == repository_uri
	input.arguments.base_branch == main_branch
	input.arguments.branch == effective_feature_branch
}

allow if {
	bound_request_context
	input.tool == "create_pull_request"
	input.required_permission.resource == repository_uri
	input.arguments.head_branch == effective_feature_branch
	input.arguments.base_branch == main_branch
}

allow if {
	bound_request_context
	input.tool == "run_tests"
	input.required_permission.resource == effective_feature_uri
	input.arguments.branch == effective_feature_branch
	input.arguments.profile == "poc-default"
}

decision := {
	"allow": allow,
	"policy_version": policy_version,
}

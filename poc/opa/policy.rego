package thesis.gateway

import rego.v1

default allow := false

policy_version := "phase4a-v1"

feature_branch := "feature/account-suspension"
main_branch := "main"
repository_uri := "gitea://gitea.local/thesis/iam-console-poc"
feature_branch_uri := "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension"

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
	input.arguments.branch == feature_branch
	startswith(input.required_permission.resource, sprintf("%s/files/", [feature_branch_uri]))
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
	input.arguments.branch == feature_branch
}

allow if {
	bound_request_context
	input.tool == "create_pull_request"
	input.required_permission.resource == repository_uri
	input.arguments.head_branch == feature_branch
	input.arguments.base_branch == main_branch
}

allow if {
	bound_request_context
	input.tool == "run_tests"
	input.required_permission.resource == feature_branch_uri
	input.arguments.branch == feature_branch
	input.arguments.profile == "poc-default"
}

decision := {
	"allow": allow,
	"policy_version": policy_version,
}

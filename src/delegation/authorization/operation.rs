use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

#[derive(Copy, Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    ReadRepository,
    ReadFile,
    ListDirectory,
    WriteFile,
    CreateFile,
    UpdateFile,
    DeleteFile,
    ReadBranch,
    CreateBranch,
    DeleteBranch,
    ReadCommitHistory,
    CreateCommit,
    ReadPullRequest,
    CreatePullRequest,
    UpdatePullRequest,
    MergePullRequest,
    ClosePullRequest,
    ReadIssue,
    CreateIssue,
    UpdateIssue,
    CloseIssue,
    CreateTag,
    DeleteTag,
    ReadRelease,
    CreateRelease,
    UpdateRelease,
    DeleteRelease,
    RunTests,
    ReadTestResults,
    TriggerWorkflow,
    ReadWorkflowStatus,
}

impl Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReadRepository => "read_repository",
            Self::ReadFile => "read_file",
            Self::ListDirectory => "list_directory",
            Self::WriteFile => "write_file",
            Self::CreateFile => "create_file",
            Self::UpdateFile => "update_file",
            Self::DeleteFile => "delete_file",
            Self::ReadBranch => "read_branch",
            Self::CreateBranch => "create_branch",
            Self::DeleteBranch => "delete_branch",
            Self::ReadCommitHistory => "read_commit_history",
            Self::CreateCommit => "create_commit",
            Self::ReadPullRequest => "read_pull_request",
            Self::CreatePullRequest => "create_pull_request",
            Self::UpdatePullRequest => "update_pull_request",
            Self::MergePullRequest => "merge_pull_request",
            Self::ClosePullRequest => "close_pull_request",
            Self::ReadIssue => "read_issue",
            Self::CreateIssue => "create_issue",
            Self::UpdateIssue => "update_issue",
            Self::CloseIssue => "close_issue",
            Self::CreateTag => "create_tag",
            Self::DeleteTag => "delete_tag",
            Self::ReadRelease => "read_release",
            Self::CreateRelease => "create_release",
            Self::UpdateRelease => "update_release",
            Self::DeleteRelease => "delete_release",
            Self::RunTests => "run_tests",
            Self::ReadTestResults => "read_test_results",
            Self::TriggerWorkflow => "trigger_workflow",
            Self::ReadWorkflowStatus => "read_workflow_status",
        }
    }
}

impl Display for Operation {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_serializes_as_snake_case() -> Result<(), String> {
        let json =
            serde_json::to_string(&Operation::CreatePullRequest).map_err(|err| err.to_string())?;

        assert_eq!(json, r#""create_pull_request""#);
        Ok(())
    }

    #[test]
    fn unknown_operation_is_rejected() {
        let result = serde_json::from_str::<Operation>(r#""arbitrary_operation""#);
        assert!(result.is_err());
    }
}

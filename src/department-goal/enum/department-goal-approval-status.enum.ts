// Tracks one (cycle, department) pair's progress through the cycle's
// configured approvalChain. currentLevel on DepartmentGoalApproval says
// *which* level this status is about — PENDING/CHANGES_REQUESTED both mean
// "currentLevel hasn't approved yet", they just differ on whether the HOD
// has something to act on.
export enum DepartmentGoalApprovalStatus {
  PENDING = 'PENDING',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  COMPLETE = 'COMPLETE',
}

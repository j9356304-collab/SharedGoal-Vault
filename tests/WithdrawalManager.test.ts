import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV, boolCV, ClarityType } from "@stacks/transactions";

const ERR_NOT_OWNER = 200;
const ERR_GOAL_NOT_FOUND = 201;
const ERR_GOAL_NOT_ACHIEVED = 202;
const ERR_GOAL_ACHIEVED = 203;
const ERR_INVALID_VOTE = 204;
const ERR_VOTING_NOT_OPEN = 205;
const ERR_ALREADY_VOTED = 206;
const ERR_INSUFFICIENT_VOTES = 207;
const ERR_TIME_LOCK_NOT_EXPIRED = 208;
const ERR_INVALID_PAYOUT_AMOUNT = 209;
const ERR_REFUND_NOT_AUTHORIZED = 210;
const ERR_ORACLE_NOT_VERIFIED = 211;
const ERR_MULTI_SIG_FAILED = 212;
const ERR_WITHDRAWAL_EXECUTED = 213;
const ERR_INVALID_GOAL_STATUS = 214;
const ERR_MIN_VOTERS_NOT_MET = 215;
const ERR_PAYOUT_CLAIMED = 216;

interface GoalStatus {
  targetAmount: number;
  currentBalance: number;
  deadline: number;
  achieved: boolean;
  refunded: boolean;
  payoutClaimed: boolean;
}

interface WithdrawalRequest {
  goalId: number;
  requester: string;
  reason: string;
  votesFor: number;
  votesAgainst: number;
  totalVoters: number;
  votingDeadline: number;
  executed: boolean;
  refundAmount: number;
}

interface ParticipantShare {
  goalId: number;
  participant: string;
  share: number;
}

interface Vote {
  goalId: number;
  voter: string;
  voteFor: boolean;
}

interface ClaimedPayout {
  goalId: number;
  claimant: string;
  claimed: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class WithdrawalManagerMock {
  state: {
    admin: string;
    oraclePrincipal: string | null;
    minVotingThreshold: number;
    timeLockDuration: number;
    maxVoters: number;
    goalStatus: Map<number, GoalStatus>;
    withdrawalRequests: Map<number, WithdrawalRequest>;
    participantShares: Map<string, number>;
    withdrawalVotes: Map<string, boolean>;
    claimedPayouts: Map<string, boolean>;
  } = {
    admin: "ST1ADMIN",
    oraclePrincipal: null,
    minVotingThreshold: 51,
    timeLockDuration: 100,
    maxVoters: 20,
    goalStatus: new Map(),
    withdrawalRequests: new Map(),
    participantShares: new Map(),
    withdrawalVotes: new Map(),
    claimedPayouts: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      admin: "ST1ADMIN",
      oraclePrincipal: null,
      minVotingThreshold: 51,
      timeLockDuration: 100,
      maxVoters: 20,
      goalStatus: new Map(),
      withdrawalRequests: new Map(),
      participantShares: new Map(),
      withdrawalVotes: new Map(),
      claimedPayouts: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  isAdmin(): boolean {
    return this.caller === this.state.admin;
  }

  isVerifiedOracle(): boolean {
    return this.caller === this.state.oraclePrincipal;
  }

  setAdmin(newAdmin: string): Result<boolean> {
    if (!this.isAdmin()) return { ok: false, value: false };
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  setOracle(oracle: string): Result<boolean> {
    if (!this.isAdmin()) return { ok: false, value: false };
    this.state.oraclePrincipal = oracle;
    return { ok: true, value: true };
  }

  setMinVotingThreshold(threshold: number): Result<boolean> {
    if (!this.isAdmin()) return { ok: false, value: false };
    if (threshold <= 0 || threshold > 100) return { ok: false, value: false };
    this.state.minVotingThreshold = threshold;
    return { ok: true, value: true };
  }

  setTimeLockDuration(duration: number): Result<boolean> {
    if (!this.isAdmin()) return { ok: false, value: false };
    if (duration <= 0) return { ok: false, value: false };
    this.state.timeLockDuration = duration;
    return { ok: true, value: true };
  }

  setMaxVoters(max: number): Result<boolean> {
    if (!this.isAdmin()) return { ok: false, value: false };
    if (max <= 0) return { ok: false, value: false };
    this.state.maxVoters = max;
    return { ok: true, value: true };
  }

  updateGoalStatus(goalId: number, target: number, current: number, deadline: number, achieved: boolean): Result<boolean> {
    if (goalId <= 0) return { ok: false, value: false };
    if (!this.isVerifiedOracle()) return { ok: false, value: false };
    this.state.goalStatus.set(goalId, { targetAmount: target, currentBalance: current, deadline, achieved, refunded: false, payoutClaimed: false });
    return { ok: true, value: true };
  }

  initiateRefund(goalId: number, reason: string, refundAmount: number): Result<boolean> {
    if (goalId <= 0) return { ok: false, value: false };
    const status = this.state.goalStatus.get(goalId);
    if (!status) return { ok: false, value: false };
    if (status.achieved || status.refunded || this.blockHeight < status.deadline) return { ok: false, value: false };
    if (this.state.withdrawalRequests.has(goalId)) return { ok: false, value: false };
    if (refundAmount > status.currentBalance) return { ok: false, value: false };
    if (reason.length > 200) return { ok: false, value: false };
    this.state.withdrawalRequests.set(goalId, {
      goalId,
      requester: this.caller,
      reason,
      votesFor: 0,
      votesAgainst: 0,
      totalVoters: 0,
      votingDeadline: this.blockHeight + this.state.timeLockDuration,
      executed: false,
      refundAmount,
    });
    return { ok: true, value: true };
  }

  voteOnWithdrawal(goalId: number, voteFor: boolean): Result<boolean> {
    if (goalId <= 0) return { ok: false, value: false };
    const req = this.state.withdrawalRequests.get(goalId);
    if (!req) return { ok: false, value: false };
    if (this.blockHeight >= req.votingDeadline || req.executed) return { ok: false, value: false };
    const voteKey = `${goalId}-${this.caller}`;
    if (this.state.withdrawalVotes.has(voteKey)) return { ok: false, value: false };
    this.state.withdrawalVotes.set(voteKey, voteFor);
    if (voteFor) {
      req.votesFor += 1;
    } else {
      req.votesAgainst += 1;
    }
    req.totalVoters += 1;
    this.state.withdrawalRequests.set(goalId, req);
    return { ok: true, value: true };
  }

  executeWithdrawal(goalId: number): Result<boolean> {
    if (goalId <= 0) return { ok: false, value: false };
    const req = this.state.withdrawalRequests.get(goalId);
    if (!req) return { ok: false, value: false };
    const status = this.state.goalStatus.get(goalId);
    if (!status) return { ok: false, value: false };
    if (this.blockHeight < req.votingDeadline) return { ok: false, value: false };
    if (req.executed) return { ok: false, value: false };
    const threshold = (this.state.minVotingThreshold * req.totalVoters);
    if (req.votesFor * 100 <= threshold) return { ok: false, value: false };
    req.executed = true;
    this.state.withdrawalRequests.set(goalId, req);
    status.refunded = true;
    this.state.goalStatus.set(goalId, status);
    if (req.refundAmount > 0) {
      this.stxTransfers.push({ amount: req.refundAmount, from: "contract", to: req.requester });
    }
    return { ok: true, value: true };
  }

  claimPayout(goalId: number): Result<boolean> {
    if (goalId <= 0) return { ok: false, value: false };
    const status = this.state.goalStatus.get(goalId);
    if (!status) return { ok: false, value: false };
    if (!status.achieved || status.payoutClaimed) return { ok: false, value: false };
    const shareKey = `${goalId}-${this.caller}`;
    const share = this.state.participantShares.get(shareKey) || 0;
    if (share <= 0) return { ok: false, value: false };
    const claimKey = `${goalId}-${this.caller}`;
    if (this.state.claimedPayouts.has(claimKey)) return { ok: false, value: false };
    const payoutAmount = Math.floor((share * status.currentBalance) / 100);
    if (payoutAmount <= 0) return { ok: false, value: false };
    this.stxTransfers.push({ amount: payoutAmount, from: "contract", to: this.caller });
    this.state.claimedPayouts.set(claimKey, true);
    status.payoutClaimed = true;
    this.state.goalStatus.set(goalId, status);
    return { ok: true, value: true };
  }

  setParticipantShare(goalId: number, participant: string, share: number): Result<boolean> {
    if (goalId <= 0) return { ok: false, value: false };
    if (!this.isAdmin()) return { ok: false, value: false };
    if (share <= 0) return { ok: false, value: false };
    const shareKey = `${goalId}-${participant}`;
    this.state.participantShares.set(shareKey, share);
    return { ok: true, value: true };
  }

  getGoalStatus(goalId: number): GoalStatus | null {
    return this.state.goalStatus.get(goalId) || null;
  }

  getWithdrawalRequest(goalId: number): WithdrawalRequest | null {
    return this.state.withdrawalRequests.get(goalId) || null;
  }

  getParticipantShare(goalId: number, participant: string): number | null {
    const key = `${goalId}-${participant}`;
    return this.state.participantShares.get(key) || null;
  }
}

describe("WithdrawalManager", () => {
  let contract: WithdrawalManagerMock;

  beforeEach(() => {
    contract = new WithdrawalManagerMock();
    contract.reset();
    contract.caller = "ST1TEST";
    contract.blockHeight = 10;
  });

  it("sets admin successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setAdmin("ST2NEWADMIN");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.admin).toBe("ST2NEWADMIN");
  });

  it("rejects set admin by non-admin", () => {
    const result = contract.setAdmin("ST2NEWADMIN");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets oracle successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setOracle("ST1ORACLE");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.oraclePrincipal).toBe("ST1ORACLE");
  });

  it("rejects set oracle by non-admin", () => {
    const result = contract.setOracle("ST1ORACLE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets min voting threshold successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setMinVotingThreshold(60);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.minVotingThreshold).toBe(60);
  });

  it("rejects invalid min voting threshold", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setMinVotingThreshold(101);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets time lock duration successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setTimeLockDuration(200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.timeLockDuration).toBe(200);
  });

  it("rejects invalid time lock duration", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setTimeLockDuration(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("updates goal status successfully by oracle", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    const result = contract.updateGoalStatus(1, 1000, 1200, 20, true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const status = contract.getGoalStatus(1);
    expect(status?.targetAmount).toBe(1000);
    expect(status?.currentBalance).toBe(1200);
    expect(status?.deadline).toBe(20);
    expect(status?.achieved).toBe(true);
    expect(status?.refunded).toBe(false);
    expect(status?.payoutClaimed).toBe(false);
  });

  it("rejects update goal status by non-oracle", () => {
    const result = contract.updateGoalStatus(1, 1000, 1200, 20, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("initiates refund successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 500, 5, false);
    contract.caller = "ST1TEST";
    const result = contract.initiateRefund(1, "Failed goal", 500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const req = contract.getWithdrawalRequest(1);
    expect(req?.goalId).toBe(1);
    expect(req?.requester).toBe("ST1TEST");
    expect(req?.reason).toBe("Failed goal");
    expect(req?.refundAmount).toBe(500);
    expect(req?.votingDeadline).toBe(110);
  });

  it("rejects initiate refund for achieved goal", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 1200, 20, true);
    contract.caller = "ST1TEST";
    const result = contract.initiateRefund(1, "Reason", 500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects initiate refund before deadline", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 500, 15, false);
    contract.caller = "ST1TEST";
    const result = contract.initiateRefund(1, "Reason", 500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects initiate refund if already requested", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 500, 5, false);
    contract.caller = "ST1TEST";
    contract.initiateRefund(1, "Reason", 500);
    const result = contract.initiateRefund(1, "Another", 300);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("votes on withdrawal successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 500, 5, false);
    contract.caller = "ST1TEST";
    contract.initiateRefund(1, "Reason", 500);
    const result = contract.voteOnWithdrawal(1, true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const req = contract.getWithdrawalRequest(1);
    expect(req?.votesFor).toBe(1);
    expect(req?.totalVoters).toBe(1);
  });

  it("rejects vote after deadline", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 500, 5, false);
    contract.caller = "ST1TEST";
    contract.initiateRefund(1, "Reason", 500);
    contract.blockHeight = 110;
    const result = contract.voteOnWithdrawal(1, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects duplicate vote", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 500, 5, false);
    contract.caller = "ST1TEST";
    contract.initiateRefund(1, "Reason", 500);
    contract.voteOnWithdrawal(1, true);
    const result = contract.voteOnWithdrawal(1, false);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("executes withdrawal successfully with sufficient votes", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 500, 5, false);
    contract.caller = "ST1TEST";
    contract.initiateRefund(1, "Reason", 500);
    contract.caller = "ST2VOTER";
    contract.voteOnWithdrawal(1, true);
    contract.caller = "ST3VOTER";
    contract.voteOnWithdrawal(1, true);
    contract.caller = "ST1TEST";
    contract.blockHeight = 110;
    contract.state.minVotingThreshold = 50;
    const result = contract.executeWithdrawal(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const req = contract.getWithdrawalRequest(1);
    expect(req?.executed).toBe(true);
    const status = contract.getGoalStatus(1);
    expect(status?.refunded).toBe(true);
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "contract", to: "ST1TEST" }]);
  });

  it("rejects execute withdrawal without sufficient votes", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 500, 5, false);
    contract.caller = "ST1TEST";
    contract.initiateRefund(1, "Reason", 500);
    contract.caller = "ST2VOTER";
    contract.voteOnWithdrawal(1, false);
    contract.blockHeight = 110;
    const result = contract.executeWithdrawal(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("claims payout successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 1200, 20, true);
    contract.caller = "ST1ADMIN";
    contract.setParticipantShare(1, "ST1TEST", 25);
    contract.caller = "ST1TEST";
    const result = contract.claimPayout(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const status = contract.getGoalStatus(1);
    expect(status?.payoutClaimed).toBe(true);
    expect(contract.stxTransfers).toEqual([{ amount: 300, from: "contract", to: "ST1TEST" }]);
  });

  it("rejects claim payout for non-achieved goal", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 800, 20, false);
    contract.caller = "ST1TEST";
    const result = contract.claimPayout(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects claim payout if already claimed", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 1200, 20, true);
    contract.caller = "ST1ADMIN";
    contract.setParticipantShare(1, "ST1TEST", 25);
    contract.caller = "ST1TEST";
    contract.claimPayout(1);
    const result = contract.claimPayout(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects claim payout without share", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 1200, 20, true);
    contract.caller = "ST1TEST";
    const result = contract.claimPayout(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets participant share successfully by admin", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setParticipantShare(1, "ST1TEST", 25);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getParticipantShare(1, "ST1TEST")).toBe(25);
  });

  it("rejects set participant share by non-admin", () => {
    const result = contract.setParticipantShare(1, "ST1TEST", 25);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects set participant share with invalid amount", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setParticipantShare(1, "ST1TEST", 0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("parses Clarity types for vote", () => {
    const goalIdCV = uintCV(1);
    const voteForCV = boolCV(true);
    expect(goalIdCV.value.toString()).toBe("1");
    expect(voteForCV.type).toBe(ClarityType.BoolTrue);
  });

  it("parses Clarity types for claim payout", () => {
    const goalIdCV = uintCV(1);
    expect(goalIdCV.value.toString()).toBe("1");
  });

  it("handles multiple voters correctly", () => {
    contract.caller = "ST1ADMIN";
    contract.setOracle("ST1ORACLE");
    contract.caller = "ST1ORACLE";
    contract.updateGoalStatus(1, 1000, 500, 5, false);
    contract.caller = "ST1TEST";
    contract.initiateRefund(1, "Reason", 500);
    contract.caller = "ST2VOTER";
    contract.voteOnWithdrawal(1, true);
    contract.caller = "ST3VOTER";
    contract.voteOnWithdrawal(1, true);
    contract.caller = "ST4VOTER";
    contract.voteOnWithdrawal(1, false);
    const req = contract.getWithdrawalRequest(1);
    expect(req?.votesFor).toBe(2);
    expect(req?.votesAgainst).toBe(1);
    expect(req?.totalVoters).toBe(3);
  });
});
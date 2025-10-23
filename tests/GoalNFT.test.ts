import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV, listCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_TARGET_AMOUNT = 102;
const ERR_INVALID_DEADLINE = 103;
const ERR_INVALID_PARTICIPANT = 104;
const ERR_GOAL_ALREADY_EXISTS = 105;
const ERR_GOAL_NOT_FOUND = 106;
const ERR_INVALID_METADATA = 107;
const ERR_MAX_GOALS_EXCEEDED = 110;
const ERR_INVALID_STATUS = 111;
const ERR_INVALID_NFT_INDEX = 112;
const ERR_INVALID_CURRENCY = 113;
const ERR_INVALID_PARTICIPANT_COUNT = 114;
const ERR_AUTHORITY_NOT_VERIFIED = 115;

interface Goal {
  name: string;
  targetAmount: number;
  deadline: number;
  creator: string;
  status: string;
  currency: string;
  participantCount: number;
  metadata: string;
  participants: string[];
}

interface GoalNFT {
  owner: string;
  goalId: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class GoalNFTMock {
  state: {
    nextGoalId: number;
    maxGoals: number;
    creationFee: number;
    authorityContract: string | null;
    goals: Map<number, Goal>;
    goalNfts: Map<number, GoalNFT>;
    goalsByName: Map<string, number>;
  } = {
    nextGoalId: 0,
    maxGoals: 1000,
    creationFee: 1000,
    authorityContract: null,
    goals: new Map(),
    goalNfts: new Map(),
    goalsByName: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
  authorities: Set<string> = new Set(["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextGoalId: 0,
      maxGoals: 1000,
      creationFee: 1000,
      authorityContract: null,
      goals: new Map(),
      goalNfts: new Map(),
      goalsByName: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    this.authorities = new Set(["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]);
    this.stxTransfers = [];
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) {
      return { ok: false, value: false };
    }
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  createGoal(
    name: string,
    targetAmount: number,
    deadline: number,
    currency: string,
    metadata: string,
    participants: string[]
  ): Result<number> {
    if (this.state.nextGoalId >= this.state.maxGoals) {
      return { ok: false, value: ERR_MAX_GOALS_EXCEEDED };
    }
    if (!name || name.length > 100) {
      return { ok: false, value: ERR_INVALID_METADATA };
    }
    if (targetAmount <= 0) {
      return { ok: false, value: ERR_INVALID_TARGET_AMOUNT };
    }
    if (deadline <= this.blockHeight) {
      return { ok: false, value: ERR_INVALID_DEADLINE };
    }
    if (!["STX", "USD"].includes(currency)) {
      return { ok: false, value: ERR_INVALID_CURRENCY };
    }
    if (metadata.length > 256) {
      return { ok: false, value: ERR_INVALID_METADATA };
    }
    if (participants.length <= 0 || participants.length > 50) {
      return { ok: false, value: ERR_INVALID_PARTICIPANT_COUNT };
    }
    for (const participant of participants) {
      if (participant === "SP000000000000000000002Q6VF78") {
        return { ok: false, value: ERR_INVALID_PARTICIPANT };
      }
    }
    if (this.state.goalsByName.has(name)) {
      return { ok: false, value: ERR_GOAL_ALREADY_EXISTS };
    }
    if (!this.state.authorityContract) {
      return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    }

    this.stxTransfers.push({
      amount: this.state.creationFee,
      from: this.caller,
      to: this.state.authorityContract,
    });

    const goalId = this.state.nextGoalId;
    const nftId = goalId;
    const goal: Goal = {
      name,
      targetAmount,
      deadline,
      creator: this.caller,
      status: "active",
      currency,
      participantCount: participants.length,
      metadata,
      participants,
    };
    this.state.goals.set(goalId, goal);
    this.state.goalNfts.set(nftId, { owner: this.caller, goalId });
    this.state.goalsByName.set(name, goalId);
    this.state.nextGoalId++;
    return { ok: true, value: nftId };
  }

  getGoal(goalId: number): Goal | null {
    return this.state.goals.get(goalId) || null;
  }

  getGoalNFT(nftId: number): GoalNFT | null {
    return this.state.goalNfts.get(nftId) || null;
  }

  getGoalByName(name: string): Goal | null {
    const goalId = this.state.goalsByName.get(name);
    if (goalId === undefined) return null;
    return this.state.goals.get(goalId) || null;
  }

  getGoalCount(): Result<number> {
    return { ok: true, value: this.state.nextGoalId };
  }

  isGoalRegistered(name: string): Result<boolean> {
    return { ok: true, value: this.state.goalsByName.has(name) };
  }

  transferGoalNFT(nftId: number, recipient: string): Result<boolean> {
    const nft = this.state.goalNfts.get(nftId);
    if (!nft) {
      return { ok: false, value: false };
    }
    if (nft.owner !== this.caller) {
      return { ok: false, value: false };
    }
    if (recipient === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    const goal = this.state.goals.get(nft.goalId);
    if (!goal || goal.status !== "active") {
      return { ok: false, value: false };
    }
    this.state.goalNfts.set(nftId, { owner: recipient, goalId: nft.goalId });
    return { ok: true, value: true };
  }

  updateGoalMetadata(goalId: number, newMetadata: string): Result<boolean> {
    const goal = this.state.goals.get(goalId);
    if (!goal) {
      return { ok: false, value: false };
    }
    if (goal.creator !== this.caller) {
      return { ok: false, value: false };
    }
    if (goal.status !== "active") {
      return { ok: false, value: false };
    }
    if (newMetadata.length > 256) {
      return { ok: false, value: false };
    }
    this.state.goals.set(goalId, { ...goal, metadata: newMetadata });
    return { ok: true, value: true };
  }

  addParticipant(goalId: number, newParticipant: string): Result<boolean> {
    const goal = this.state.goals.get(goalId);
    if (!goal) {
      return { ok: false, value: false };
    }
    if (goal.creator !== this.caller) {
      return { ok: false, value: false };
    }
    if (goal.participantCount >= 50) {
      return { ok: false, value: false };
    }
    if (newParticipant === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (goal.status !== "active") {
      return { ok: false, value: false };
    }
    const newParticipants = [...goal.participants, newParticipant];
    if (newParticipants.length > 50) {
      return { ok: false, value: false };
    }
    this.state.goals.set(goalId, {
      ...goal,
      participantCount: goal.participantCount + 1,
      participants: newParticipants,
    });
    return { ok: true, value: true };
  }

  setGoalStatus(goalId: number, newStatus: string): Result<boolean> {
    const goal = this.state.goals.get(goalId);
    if (!goal) {
      return { ok: false, value: false };
    }
    if (goal.creator !== this.caller) {
      return { ok: false, value: false };
    }
    if (!["active", "completed", "cancelled"].includes(newStatus)) {
      return { ok: false, value: false };
    }
    this.state.goals.set(goalId, { ...goal, status: newStatus });
    return { ok: true, value: true };
  }
}

describe("GoalNFT", () => {
  let contract: GoalNFTMock;

  beforeEach(() => {
    contract = new GoalNFTMock();
    contract.reset();
  });

  it("creates a goal successfully", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    const result = contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0"]
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const goal = contract.getGoal(0);
    expect(goal?.name).toBe("Vacation Fund");
    expect(goal?.targetAmount).toBe(1000);
    expect(goal?.deadline).toBe(100);
    expect(goal?.currency).toBe("STX");
    expect(goal?.metadata).toBe("Save for a beach trip");
    expect(goal?.participantCount).toBe(2);
    expect(goal?.participants).toEqual(["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0"]);
    expect(goal?.status).toBe("active");

    const nft = contract.getGoalNFT(0);
    expect(nft?.owner).toBe("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM");
    expect(nft?.goalId).toBe(0);

    expect(contract.stxTransfers).toEqual([
      { amount: 1000, from: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", to: "ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0" },
    ]);
  });

  it("rejects duplicate goal names", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    const result = contract.createGoal(
      "Vacation Fund",
      2000,
      200,
      "USD",
      "Another trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_GOAL_ALREADY_EXISTS);
  });

  it("rejects invalid target amount", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    const result = contract.createGoal(
      "Invalid Goal",
      0,
      100,
      "STX",
      "Invalid amount",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TARGET_AMOUNT);
  });

  it("rejects invalid deadline", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.blockHeight = 100;
    const result = contract.createGoal(
      "Invalid Goal",
      1000,
      50,
      "STX",
      "Invalid deadline",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DEADLINE);
  });

  it("rejects invalid currency", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    const result = contract.createGoal(
      "Invalid Goal",
      1000,
      100,
      "BTC",
      "Invalid currency",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CURRENCY);
  });

  it("rejects invalid participant count", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    const result = contract.createGoal(
      "Invalid Goal",
      1000,
      100,
      "STX",
      "No participants",
      []
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PARTICIPANT_COUNT);
  });

  it("rejects invalid participant", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    const result = contract.createGoal(
      "Invalid Goal",
      1000,
      100,
      "STX",
      "Invalid participant",
      ["SP000000000000000000002Q6VF78"]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PARTICIPANT);
  });

  it("transfers goal NFT successfully", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    const result = contract.transferGoalNFT(0, "ST3REH8Z63V3S7Z6Z3Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const nft = contract.getGoalNFT(0);
    expect(nft?.owner).toBe("ST3REH8Z63V3S7Z6Z3Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z");
    expect(nft?.goalId).toBe(0);
  });

  it("rejects transfer by non-owner", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    contract.caller = "ST3REH8Z63V3S7Z6Z3Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z";
    const result = contract.transferGoalNFT(0, "ST4STCPRXH2A3W3W3W3W3W3W3W3W3W3W3W3W3W3W");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects transfer for non-existent NFT", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    const result = contract.transferGoalNFT(99, "ST3REH8Z63V3S7Z6Z3Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("updates metadata successfully", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    const result = contract.updateGoalMetadata(0, "Updated trip plan");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const goal = contract.getGoal(0);
    expect(goal?.metadata).toBe("Updated trip plan");
  });

  it("rejects metadata update by non-creator", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    contract.caller = "ST3REH8Z63V3S7Z6Z3Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z";
    const result = contract.updateGoalMetadata(0, "Unauthorized update");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("adds participant successfully", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    const result = contract.addParticipant(0, "ST3REH8Z63V3S7Z6Z3Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const goal = contract.getGoal(0);
    expect(goal?.participantCount).toBe(2);
    expect(goal?.participants).toEqual(["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "ST3REH8Z63V3S7Z6Z3Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z"]);
  });

  it("rejects participant addition by non-creator", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    contract.caller = "ST3REH8Z63V3S7Z6Z3Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z2Z";
    const result = contract.addParticipant(0, "ST4STCPRXH2A3W3W3W3W3W3W3W3W3W3W3W3W3W3W");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets goal status successfully", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    const result = contract.setGoalStatus(0, "completed");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const goal = contract.getGoal(0);
    expect(goal?.status).toBe("completed");
  });

  it("rejects invalid status", () => {
    contract.setAuthorityContract("ST2CY5V39QN1H3F29K5Z5CT6AWB0H8Y3JC7A9G2V0");
    contract.createGoal(
      "Vacation Fund",
      1000,
      100,
      "STX",
      "Save for a beach trip",
      ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"]
    );
    const result = contract.setGoalStatus(0, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});
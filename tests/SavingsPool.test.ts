import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_GOAL_ID = 101;
const ERR_INSUFFICIENT_BALANCE = 102;
const ERR_GOAL_NOT_FOUND = 103;
const ERR_DEPOSIT_FAILED = 104;
const ERR_WITHDRAWAL_FAILED = 105;
const ERR_LOCK_ALREADY_APPLIED = 106;
const ERR_GOAL_NOT_LOCKED = 107;
const ERR_INVALID_AMOUNT = 108;
const ERR_DEADLINE_PASSED = 109;
const ERR_GOAL_NOT_ACTIVE = 110;
const ERR_ORACLE_NOT_VERIFIED = 111;
const ERR_INVALID_TOKEN = 112;
const ERR_POOL_EMPTY = 113;
const ERR_MAX_DEPOSITS_EXCEEDED = 114;

interface Pool {
  goalId: number;
  totalBalance: number;
  targetAmount: number;
  deadline: number;
  isLocked: boolean;
  tokenType: string;
  active: boolean;
  creator: string;
}

interface Contribution {
  amount: number;
  timestamp: number;
  sharePercentage: number;
}

interface PoolProgress {
  balance: number;
  target: number;
  progress: number;
  locked: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class SavingsPoolMock {
  state: {
    admin: string;
    oracle: string;
    maxPools: number;
    depositFee: number;
    pools: Map<number, Pool>;
    contributions: Map<string, Contribution>;
    poolBalances: Map<number, number>;
    lockedFunds: Map<number, boolean>;
    blockHeight: number;
  } = {
    admin: "ST1ADMIN",
    oracle: "ST1ORACLE",
    maxPools: 1000,
    depositFee: 50,
    pools: new Map(),
    contributions: new Map(),
    poolBalances: new Map(),
    lockedFunds: new Map(),
    blockHeight: 0,
  };
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string; memo?: string }> = [];
  ftTransfers: Array<{ amount: number; from: string; to: string; contract: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      admin: "ST1ADMIN",
      oracle: "ST1ORACLE",
      maxPools: 1000,
      depositFee: 50,
      pools: new Map(),
      contributions: new Map(),
      poolBalances: new Map(),
      lockedFunds: new Map(),
      blockHeight: 0,
    };
    this.caller = "ST1TEST";
    this.stxTransfers = [];
    this.ftTransfers = [];
  }

  isAdmin(): Result<boolean> {
    return { ok: true, value: this.caller === this.state.admin };
  }

  isOracle(): Result<boolean> {
    return { ok: true, value: this.caller === this.state.oracle };
  }

  validateGoalId(id: number): Result<boolean> {
    return id > 0 ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_GOAL_ID };
  }

  validateAmount(amt: number): Result<boolean> {
    return amt > 0 ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_AMOUNT };
  }

  validateDeadline(dl: number): Result<boolean> {
    return dl > this.state.blockHeight ? { ok: true, value: true } : { ok: false, value: ERR_DEADLINE_PASSED };
  }

  validateActivePool(pool: Pool | null): Result<boolean> {
    return pool && pool.active ? { ok: true, value: true } : { ok: false, value: ERR_GOAL_NOT_ACTIVE };
  }

  getPoolIdCount(): number {
    return Array.from(this.state.pools.keys()).length;
  }

  initializePool(
    goalId: number,
    targetAmount: number,
    deadline: number,
    tokenType: string
  ): Result<number> {
    if (!this.isAdmin().value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.validateGoalId(goalId).ok !== true) return { ok: false, value: this.validateGoalId(goalId).value };
    if (this.validateAmount(targetAmount).ok !== true) return { ok: false, value: this.validateAmount(targetAmount).value };
    if (this.validateDeadline(deadline).ok !== true) return { ok: false, value: this.validateDeadline(deadline).value };
    if (this.state.pools.has(goalId)) return { ok: false, value: ERR_GOAL_NOT_FOUND };
    if (this.getPoolIdCount() + 1 > this.state.maxPools) return { ok: false, value: ERR_MAX_DEPOSITS_EXCEEDED };

    const pool: Pool = {
      goalId,
      totalBalance: 0,
      targetAmount,
      deadline,
      isLocked: false,
      tokenType,
      active: true,
      creator: this.caller,
    };
    this.state.pools.set(goalId, pool);
    this.state.poolBalances.set(goalId, 0);
    this.state.lockedFunds.set(goalId, false);
    return { ok: true, value: goalId };
  }

  depositStx(goalId: number, amount: number): Result<number> {
    const pool = this.state.pools.get(goalId);
    if (!pool) return { ok: false, value: ERR_GOAL_NOT_FOUND };
    if (this.validateActivePool(pool).ok !== true) return { ok: false, value: this.validateActivePool(pool).value };
    if (this.validateAmount(amount).ok !== true) return { ok: false, value: this.validateAmount(amount).value };
    if (pool.isLocked) return { ok: false, value: ERR_GOAL_NOT_ACTIVE };
    if (this.state.blockHeight > pool.deadline) return { ok: false, value: ERR_DEADLINE_PASSED };
    if (pool.tokenType !== "STX") return { ok: false, value: ERR_INVALID_TOKEN };

    this.stxTransfers.push({ amount, from: this.caller, to: "contract", memo: "Savings Deposit" });
    const newBalance = pool.totalBalance + amount;
    this.state.pools.set(goalId, { ...pool, totalBalance: newBalance });
    this.state.poolBalances.set(goalId, newBalance);
    const key = `${goalId}-${this.caller}`;
    const existing = this.state.contributions.get(key);
    const totalContrib = (existing?.amount || 0) + amount;
    const share = this.calculateShare(newBalance, pool.targetAmount);
    this.state.contributions.set(key, { amount: totalContrib, timestamp: this.state.blockHeight, sharePercentage: share });
    return { ok: true, value: newBalance };
  }

  depositFt(goalId: number, amount: number, tokenContract: string): Result<number> {
    const pool = this.state.pools.get(goalId);
    if (!pool) return { ok: false, value: ERR_GOAL_NOT_FOUND };
    if (this.validateActivePool(pool).ok !== true) return { ok: false, value: this.validateActivePool(pool).value };
    if (this.validateAmount(amount).ok !== true) return { ok: false, value: this.validateAmount(amount).value };
    if (pool.isLocked) return { ok: false, value: ERR_GOAL_NOT_ACTIVE };
    if (this.state.blockHeight > pool.deadline) return { ok: false, value: ERR_DEADLINE_PASSED };
    if (pool.tokenType !== tokenContract) return { ok: false, value: ERR_INVALID_TOKEN };

    this.ftTransfers.push({ amount, from: this.caller, to: "contract", contract: tokenContract });
    const newBalance = pool.totalBalance + amount;
    this.state.pools.set(goalId, { ...pool, totalBalance: newBalance });
    this.state.poolBalances.set(goalId, newBalance);
    const key = `${goalId}-${this.caller}`;
    const existing = this.state.contributions.get(key);
    const totalContrib = (existing?.amount || 0) + amount;
    const share = this.calculateShare(newBalance, pool.targetAmount);
    this.state.contributions.set(key, { amount: totalContrib, timestamp: this.state.blockHeight, sharePercentage: share });
    return { ok: true, value: newBalance };
  }

  private calculateShare(balance: number, target: number): number {
    return target > 0 ? Math.floor((balance * 100) / target) : 0;
  }

  lockPool(goalId: number): Result<boolean> {
    if (!this.isAdmin().value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const pool = this.state.pools.get(goalId);
    if (!pool) return { ok: false, value: ERR_GOAL_NOT_FOUND };
    if (this.validateActivePool(pool).ok !== true) return { ok: false, value: this.validateActivePool(pool).value };
    if (pool.isLocked) return { ok: false, value: ERR_LOCK_ALREADY_APPLIED };

    this.state.pools.set(goalId, { ...pool, isLocked: true });
    this.state.lockedFunds.set(goalId, true);
    return { ok: true, value: true };
  }

  unlockPool(goalId: number): Result<boolean> {
    if (!this.isAdmin().value) return { ok: false, value: ERR_NOT_AUHORIZED };
    const pool = this.state.pools.get(goalId);
    if (!pool) return { ok: false, value: ERR_GOAL_NOT_FOUND };
    if (!pool.isLocked) return { ok: false, value: ERR_GOAL_NOT_LOCKED };

    this.state.pools.set(goalId, { ...pool, isLocked: false });
    this.state.lockedFunds.set(goalId, false);
    return { ok: true, value: true };
  }

  withdrawStx(goalId: number, amount: number): Result<number> {
    const pool = this.state.pools.get(goalId);
    if (!pool) return { ok: false, value: ERR_GOAL_NOT_FOUND };
    if (this.validateActivePool(pool).ok !== true) return { ok: false, value: this.validateActivePool(pool).value };
    if (this.validateAmount(amount).ok !== true) return { ok: false, value: this.validateAmount(amount).value };
    if (pool.totalBalance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const key = `${goalId}-${this.caller}`;
    const contrib = this.state.contributions.get(key);
    if (!contrib || contrib.amount < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (pool.isLocked) return { ok: false, value: ERR_GOAL_NOT_LOCKED };
    if (pool.tokenType !== "STX") return { ok: false, value: ERR_INVALID_TOKEN };

    this.stxTransfers.push({ amount, from: "contract", to: this.caller });
    const newBalance = pool.totalBalance - amount;
    this.state.pools.set(goalId, { ...pool, totalBalance: newBalance });
    this.state.poolBalances.set(goalId, newBalance);
    const newContribAmount = contrib.amount - amount;
    const share = this.calculateShare(newBalance, pool.targetAmount);
    this.state.contributions.set(key, { ...contrib, amount: newContribAmount, sharePercentage: share, timestamp: this.state.blockHeight });
    return { ok: true, value: newBalance };
  }

  withdrawFt(goalId: number, amount: number, tokenContract: string): Result<number> {
    const pool = this.state.pools.get(goalId);
    if (!pool) return { ok: false, value: ERR_GOAL_NOT_FOUND };
    if (this.validateActivePool(pool).ok !== true) return { ok: false, value: this.validateActivePool(pool).value };
    if (this.validateAmount(amount).ok !== true) return { ok: false, value: this.validateAmount(amount).value };
    if (pool.totalBalance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const key = `${goalId}-${this.caller}`;
    const contrib = this.state.contributions.get(key);
    if (!contrib || contrib.amount < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (pool.isLocked) return { ok: false, value: ERR_GOAL_NOT_LOCKED };
    if (pool.tokenType !== tokenContract) return { ok: false, value: ERR_INVALID_TOKEN };

    this.ftTransfers.push({ amount, from: "contract", to: this.caller, contract: tokenContract });
    const newBalance = pool.totalBalance - amount;
    this.state.pools.set(goalId, { ...pool, totalBalance: newBalance });
    this.state.poolBalances.set(goalId, newBalance);
    const newContribAmount = contrib.amount - amount;
    const share = this.calculateShare(newBalance, pool.targetAmount);
    this.state.contributions.set(key, { ...contrib, amount: newContribAmount, sharePercentage: share, timestamp: this.state.blockHeight });
    return { ok: true, value: newBalance };
  }

  deactivatePool(goalId: number): Result<boolean> {
    if (!this.isAdmin().value) return { ok: false, value: ERR_NOT_AUHORIZED };
    const pool = this.state.pools.get(goalId);
    if (!pool) return { ok: false, value: ERR_GOAL_NOT_FOUND };
    if (this.validateActivePool(pool).ok !== true) return { ok: false, value: this.validateActivePool(pool).value };

    this.state.pools.set(goalId, { ...pool, active: false });
    return { ok: true, value: true };
  }

  setOracle(newOracle: string): Result<boolean> {
    if (!this.isAdmin().value) return { ok: false, value: ERR_NOT_AUHORIZED };
    this.state.oracle = newOracle;
    return { ok: true, value: true };
  }

  setDepositFee(fee: number): Result<boolean> {
    if (!this.isAdmin().value) return { ok: false, value: ERR_NOT_AUHORIZED };
    if (fee > 1000) return { ok: false, value: ERR_INVALID_AMOUNT };
    this.state.depositFee = fee;
    return { ok: true, value: true };
  }

  getPoolProgress(goalId: number): Result<PoolProgress> {
    const pool = this.state.pools.get(goalId);
    if (!pool) return { ok: false, value: ERR_GOAL_NOT_FOUND };
    const progress = this.calculateShare(pool.totalBalance, pool.targetAmount);
    return { ok: true, value: { balance: pool.totalBalance, target: pool.targetAmount, progress, locked: pool.isLocked } };
  }

  getPool(goalId: number): Pool | null {
    return this.state.pools.get(goalId) || null;
  }

  getContribution(goalId: number, contributor: string): Contribution | null {
    return this.state.contributions.get(`${goalId}-${contributor}`) || null;
  }

  getPoolBalance(goalId: number): number | undefined {
    return this.state.poolBalances.get(goalId);
  }

  isPoolLocked(goalId: number): boolean | undefined {
    return this.state.lockedFunds.get(goalId);
  }
}

describe("SavingsPool", () => {
  let contract: SavingsPoolMock;

  beforeEach(() => {
    contract = new SavingsPoolMock();
    contract.reset();
    contract.caller = "ST1ADMIN";
  });

  it("initializes a pool successfully", () => {
    const result = contract.initializePool(1, 10000, 100, "STX");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);

    const pool = contract.getPool(1);
    expect(pool?.goalId).toBe(1);
    expect(pool?.targetAmount).toBe(10000);
    expect(pool?.deadline).toBe(100);
    expect(pool?.tokenType).toBe("STX");
    expect(pool?.active).toBe(true);
    expect(contract.getPoolBalance(1)).toBe(0);
    expect(contract.isPoolLocked(1)).toBe(false);
  });

  it("rejects pool initialization by non-admin", () => {
    contract.caller = "ST2TEST";
    const result = contract.initializePool(1, 10000, 100, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects duplicate pool initialization", () => {
    contract.initializePool(1, 10000, 100, "STX");
    const result = contract.initializePool(1, 20000, 200, "USD");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_GOAL_NOT_FOUND);
  });

  it("deposits STX successfully", () => {
    contract.initializePool(1, 10000, 100, "STX");
    contract.caller = "ST1TEST";
    contract.state.blockHeight = 50;
    const result = contract.depositStx(1, 5000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(5000);

    const pool = contract.getPool(1);
    expect(pool?.totalBalance).toBe(5000);
    expect(contract.stxTransfers).toEqual([{ amount: 5000, from: "ST1TEST", to: "contract", memo: "Savings Deposit" }]);
    const contrib = contract.getContribution(1, "ST1TEST");
    expect(contrib?.amount).toBe(5000);
    expect(contrib?.sharePercentage).toBe(50);
  });

  it("rejects STX deposit for invalid goal", () => {
    const result = contract.depositStx(999, 1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_GOAL_NOT_FOUND);
  });

  it("rejects STX deposit after deadline", () => {
    contract.initializePool(1, 10000, 10, "STX");
    contract.state.blockHeight = 11;
    const result = contract.depositStx(1, 1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_DEADLINE_PASSED);
  });

  it("rejects STX deposit for wrong token type", () => {
    contract.initializePool(1, 10000, 100, "USD");
    const result = contract.depositStx(1, 1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TOKEN);
  });

  it("deposits FT successfully", () => {
    contract.initializePool(1, 10000, 100, "ST1FT");
    contract.caller = "ST1TEST";
    contract.state.blockHeight = 50;
    const result = contract.depositFt(1, 5000, "ST1FT");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(5000);

    const pool = contract.getPool(1);
    expect(pool?.totalBalance).toBe(5000);
    expect(contract.ftTransfers).toEqual([{ amount: 5000, from: "ST1TEST", to: "contract", contract: "ST1FT" }]);
  });

  it("locks a pool successfully", () => {
    contract.initializePool(1, 10000, 100, "STX");
    const result = contract.lockPool(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);

    const pool = contract.getPool(1);
    expect(pool?.isLocked).toBe(true);
    expect(contract.isPoolLocked(1)).toBe(true);
  });

  it("rejects locking already locked pool", () => {
    contract.initializePool(1, 10000, 100, "STX");
    contract.lockPool(1);
    const result = contract.lockPool(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LOCK_ALREADY_APPLIED);
  });

  it("unlocks a pool successfully", () => {
    contract.initializePool(1, 10000, 100, "STX");
    contract.lockPool(1);
    const result = contract.unlockPool(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);

    const pool = contract.getPool(1);
    expect(pool?.isLocked).toBe(false);
  });

  it("rejects unlocking unlocked pool", () => {
    contract.initializePool(1, 10000, 100, "STX");
    const result = contract.unlockPool(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_GOAL_NOT_LOCKED);
  });

  it("withdraws STX successfully", () => {
    contract.initializePool(1, 10000, 100, "STX");
    contract.caller = "ST1TEST";
    contract.state.blockHeight = 50;
    contract.depositStx(1, 5000);
    const result = contract.withdrawStx(1, 2000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(3000);

    const pool = contract.getPool(1);
    expect(pool?.totalBalance).toBe(3000);
    expect(contract.stxTransfers.length).toBe(2);
    expect(contract.stxTransfers[1]?.amount).toBe(2000);
    expect(contract.stxTransfers[1]?.from).toBe("contract");
    expect(contract.stxTransfers[1]?.to).toBe("ST1TEST");
  });

  it("rejects STX withdrawal with insufficient balance", () => {
    contract.initializePool(1, 10000, 100, "STX");
    contract.caller = "ST1TEST";
    contract.depositStx(1, 1000);
    const result = contract.withdrawStx(1, 2000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("rejects STX withdrawal from locked pool", () => {
    contract.initializePool(1, 10000, 100, "STX");
    contract.caller = "ST1TEST";
    contract.depositStx(1, 5000);
    contract.caller = "ST1ADMIN";
    contract.lockPool(1);
    contract.caller = "ST1TEST";
    const result = contract.withdrawStx(1, 1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_GOAL_NOT_LOCKED);
  });

  it("deactivates a pool successfully", () => {
    contract.initializePool(1, 10000, 100, "STX");
    const result = contract.deactivatePool(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);

    const pool = contract.getPool(1);
    expect(pool?.active).toBe(false);
  });

  it("sets oracle successfully", () => {
    const result = contract.setOracle("ST2ORACLE");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.oracle).toBe("ST2ORACLE");
  });

  it("sets deposit fee successfully", () => {
    const result = contract.setDepositFee(100);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.depositFee).toBe(100);
  });

  it("rejects high deposit fee", () => {
    const result = contract.setDepositFee(1001);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("gets pool progress correctly", () => {
    contract.initializePool(1, 10000, 100, "STX");
    contract.caller = "ST1TEST";
    contract.depositStx(1, 5000);
    const result = contract.getPoolProgress(1);
    expect(result.ok).toBe(true);
    expect(result.value.balance).toBe(5000);
    expect(result.value.target).toBe(10000);
    expect(result.value.progress).toBe(50);
    expect(result.value.locked).toBe(false);
  });

  it("rejects progress for invalid goal", () => {
    const result = contract.getPoolProgress(999);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_GOAL_NOT_FOUND);
  });

  it("rejects max pools exceeded", () => {
    contract.state.maxPools = 0;
    const result = contract.initializePool(1, 10000, 100, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_DEPOSITS_EXCEEDED);
  });

  it("parses token type with Clarity", () => {
    const cv = stringAsciiCV("STX");
    expect(cv.value).toBe("STX");
  });

  it("rejects FT deposit with wrong contract", () => {
    contract.initializePool(1, 10000, 100, "ST1FT");
    const result = contract.depositFt(1, 1000, "ST2FT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TOKEN);
  });

  it("rejects FT withdrawal with insufficient contrib", () => {
    contract.initializePool(1, 10000, 100, "ST1FT");
    contract.caller = "ST1TEST";
    contract.depositFt(1, 1000, "ST1FT");
    contract.caller = "ST2TEST";
    const result = contract.withdrawFt(1, 500, "ST1FT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });
});
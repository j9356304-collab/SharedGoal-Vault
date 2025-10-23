# SharedGoal Vault

## Overview

SharedGoal Vault is a Web3 savings application built on the Stacks blockchain using Clarity smart contracts. It allows users to create personalized savings goals (e.g., a vacation fund, emergency savings, or group purchases) that are tokenized as non-fungible tokens (NFTs). These NFTs represent ownership and participation in the goal, enabling seamless shared savings with friends or family. The project integrates with traditional banking apps via oracles to bridge fiat and crypto savings, providing transparency, trust, and automation in collaborative financial planning.

By leveraging blockchain, SharedGoal Vault solves real-world problems like lack of trust in informal group savings (e.g., "money circles" or family pots where one person might mismanage funds), opaque contribution tracking, and the disconnect between traditional banking and decentralized finance. It promotes financial inclusion by allowing low-barrier entry for shared goals, automates payouts upon goal achievement, and uses NFTs for verifiable ownership that can be traded or used as collateral in DeFi ecosystems.

The project consists of 6 core smart contracts written in Clarity, ensuring security, predictability, and Bitcoin-secured settlement through Stacks.

## Problems Solved

- **Trust Issues in Shared Savings**: Traditional group savings rely on manual tracking and trust, often leading to disputes. Blockchain ensures immutable records of contributions and automated distributions.
- **Financial Exclusion**: Many people lack access to formal banking for joint accounts. This app enables anyone with a wallet to participate in global shared goals.
- **Integration with Fiat Systems**: Bridges crypto savings with bank accounts, allowing automatic transfers or balance checks via oracles, making it user-friendly for non-crypto natives.
- **Motivation and Gamification**: Tokenizing goals as NFTs adds collectibility and resale value, encouraging consistent saving. Goals can be "leveled up" with milestones.
- **Transparency and Auditability**: All transactions are on-chain, reducing fraud in family/friend savings pools.
- **Cross-Border Collaboration**: Enables seamless international shared savings without currency conversion hassles, using STX or stablecoins.

## Architecture

SharedGoal Vault is designed with modularity in mind. It uses 6 Clarity smart contracts that interact via traits and public functions. Contracts are deployed on Stacks, with STX as the native token for fees and SIP-10 fungible tokens (e.g., stablecoins) for savings pools.

### Smart Contracts

1. **GoalNFT.clar**  
   - Purpose: Manages the creation, minting, and transfer of NFTs representing savings goals. Each NFT holds metadata like goal description, target amount, deadline, and participant list.  
   - Key Functions:  
     - `create-goal`: Mints a new NFT for a savings goal, setting initial parameters.  
     - `transfer-goal`: Transfers NFT ownership (e.g., selling a goal stake).  
     - `update-metadata`: Allows owner to update goal details (with participant consensus).  
   - Traits: Implements SIP-009 (NFT standard) for compatibility.  
   - Security: Only the creator can mint; transfers require multi-sig approval for shared goals.

2. **UserRegistry.clar**  
   - Purpose: Handles user registration, permissions, and multi-user access for shared goals. Maps principals (wallet addresses) to roles (e.g., owner, contributor).  
   - Key Functions:  
     - `register-user`: Adds a user with KYC-like metadata (optional for privacy).  
     - `add-participant`: Invites and approves friends/family to a goal.  
     - `check-permission`: Verifies if a user can contribute or withdraw.  
   - Traits: None (utility contract).  
   - Security: Uses principal checks to prevent unauthorized access; supports revocation of participants.

3. **SavingsPool.clar**  
   - Purpose: Manages the fungible token pools for savings. Holds contributions in STX or SIP-10 tokens, tracks total balance against goal targets.  
   - Key Functions:  
     - `deposit`: Allows users to contribute tokens to a specific goal NFT.  
     - `get-balance`: Returns current pool balance and progress toward target.  
     - `lock-funds`: Locks funds until goal is met or deadline passes.  
   - Traits: Implements SIP-010 (FT standard) for token interactions.  
   - Security: Funds are escrowed; no direct withdrawals without consensus.

4. **ContributionTracker.clar**  
   - Purpose: Tracks individual contributions per participant for transparency and fair distribution. Maintains a ledger of deposits per user per goal.  
   - Key Functions:  
     - `record-contribution`: Logs a deposit with timestamp and amount.  
     - `get-user-share`: Calculates proportional ownership based on contributions.  
     - `generate-report`: Exports on-chain contribution history for audits.  
   - Traits: Interacts with SavingsPool for balance verification.  
   - Security: Immutable logs prevent tampering; uses hashes for integrity.

5. **WithdrawalManager.clar**  
   - Purpose: Automates withdrawals and distributions when goals are achieved or failed. Handles refunds or payouts based on rules (e.g., majority vote for early withdrawal).  
   - Key Functions:  
     - `claim-payout`: Distributes funds proportionally if target met.  
     - `initiate-refund`: Refunds on failure or consensus.  
     - `vote-withdrawal`: Multi-sig voting for exceptional cases.  
   - Traits: Integrates with GoalNFT for status checks.  
   - Security: Time-locks and multi-sig prevent premature withdrawals; oracles can trigger based on external conditions (e.g., goal met via bank integration).

6. **BankIntegrationOracle.clar**  
   - Purpose: Facilitates integration with traditional banking apps via off-chain oracles (e.g., Chainlink on Stacks). Fetches fiat balances or triggers auto-transfers.  
   - Key Functions:  
     - `submit-oracle-data`: Updates on-chain with verified bank data (e.g., linked account balance).  
     - `trigger-deposit`: Automates crypto deposits based on fiat savings milestones.  
     - `verify-integration`: Checks API proofs for authenticity.  
   - Traits: Uses oracle traits for external data feeds.  
   - Security: Only trusted oracles can submit; data is validated with signatures.

## How It Works

1. **Create a Goal**: User mints a GoalNFT with details (target, deadline, participants).  
2. **Invite Participants**: Via UserRegistry, add friends/family who approve via wallet signatures.  
3. **Contribute**: Deposit tokens to SavingsPool; tracked in ContributionTracker.  
4. **Monitor Progress**: View balances and shares on-chain. Integrate with banking apps to auto-deposit fiat-converted crypto.  
5. **Achieve Goal**: When target hit (verified by oracle if fiat-involved), WithdrawalManager distributes funds.  
6. **NFT Utility**: Goals can be traded as NFTs, with attached pools transferring ownership.  
7. **Frontend Integration**: A dApp (not included here) would interact with these contracts via Stacks.js.

## Installation and Deployment

### Prerequisites
- Stacks Wallet (e.g., Hiro Wallet).
- Clarity development environment: Install Clarinet (`cargo install clarinet`).
- Node.js for testing (optional).

### Setup
1. Clone the repository:  
   ```
   git clone this-repo
   cd sharedgoal-vault
   ```

2. Initialize Clarinet project:  
   ```
   clarinet new .
   ```

3. Add Contracts: Copy the `.clar` files into `./contracts/`.

4. Test Contracts:  
   ```
   clarinet test
   ```

5. Deploy to Testnet: Use Clarinet to deploy:  
   ```
   clarinet deploy --testnet
   ```

6. Interact: Use Stacks Explorer or a custom dApp to call functions.

## Development Notes
- All contracts are written in Clarity for safety (no reentrancy, explicit errors).
- Testing: Each contract has unit tests in `./tests/`.
- Security: Audited for common vulnerabilities; uses read-only functions where possible.
- Future Enhancements: Add DAO governance for protocol upgrades, integrate more oracles for fiat ramps.

## License
MIT License. See LICENSE file for details.
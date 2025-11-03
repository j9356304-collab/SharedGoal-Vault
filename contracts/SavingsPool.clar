(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-INVALID-GOAL-ID (err u101))
(define-constant ERR-INSUFFICIENT-BALANCE (err u102))
(define-constant ERR-GOAL-NOT-FOUND (err u103))
(define-constant ERR-DEPOSIT-FAILED (err u104))
(define-constant ERR-WITHDRAWAL-FAILED (err u105))
(define-constant ERR-LOCK-ALREADY-APPLIED (err u106))
(define-constant ERR-GOAL-NOT-LOCKED (err u107))
(define-constant ERR-INVALID-AMOUNT (err u108))
(define-constant ERR-DEADLINE-PASSED (err u109))
(define-constant ERR-GOAL-NOT-ACTIVE (err u110))
(define-constant ERR-ORACLE-NOT-VERIFIED (err u111))
(define-constant ERR-INVALID-TOKEN (err u112))
(define-constant ERR-POOL-EMPTY (err u113))
(define-constant ERR-MAX-DEPOSITS-EXCEEDED (err u114))

(define-data-var admin principal tx-sender)
(define-data-var oracle principal tx-sender)
(define-data-var max-pools uint u1000)
(define-data-var pool-count uint u0)
(define-data-var deposit-fee uint u50)

(define-map pools
  uint
  {
    goal-id: uint,
    total-balance: uint,
    target-amount: uint,
    deadline: uint,
    is-locked: bool,
    token-type: (string-ascii 10),
    active: bool,
    creator: principal
  }
)

(define-map contributions
  { goal-id: uint, contributor: principal }
  {
    amount: uint,
    timestamp: uint,
    share-percentage: uint
  }
)

(define-map pool-balances
  uint
  uint
)

(define-map locked-funds
  uint
  bool
)

(define-read-only (get-pool (goal-id uint))
  (map-get? pools goal-id)
)

(define-read-only (get-contribution (goal-id uint) (contributor principal))
  (map-get? contributions { goal-id: goal-id, contributor: contributor })
)

(define-read-only (get-pool-balance (goal-id uint))
  (map-get? pool-balances goal-id)
)

(define-read-only (is-pool-locked (goal-id uint))
  (map-get? locked-funds goal-id)
)

(define-private (validate-admin)
  (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-AUTHORIZED)
)

(define-private (validate-oracle)
  (asserts! (is-eq tx-sender (var-get oracle)) ERR-ORACLE-NOT-VERIFIED)
)

(define-private (validate-goal-id (id uint))
  (if (> id u0) (ok true) ERR-INVALID-GOAL-ID)
)

(define-private (validate-amount (amt uint))
  (if (> amt u0) (ok true) ERR-INVALID-AMOUNT)
)

(define-private (validate-deadline (dl uint))
  (if (> dl block-height) (ok true) ERR-DEADLINE-PASSED)
)

(define-private (validate-active-pool (pool (optional
  {
    goal-id: uint,
    total-balance: uint,
    target-amount: uint,
    deadline: uint,
    is-locked: bool,
    token-type: (string-ascii 10),
    active: bool,
    creator: principal
  }
)))
  (match pool p
    (if (get active p) (ok true) ERR-GOAL-NOT-ACTIVE)
    ERR-GOAL-NOT-FOUND
  )
)

(define-public (initialize-pool
  (goal-id uint)
  (target-amount uint)
  (deadline uint)
  (token-type (string-ascii 10))
)
  (begin
    (try! (validate-admin))
    (try! (validate-goal-id goal-id))
    (try! (validate-amount target-amount))
    (try! (validate-deadline deadline))
    (asserts! (is-none (map-get? pools goal-id)) ERR-GOAL-NOT-FOUND)
    (asserts! (<= (+ (var-get pool-count) u1) (var-get max-pools)) ERR-MAX-DEPOSITS-EXCEEDED)
    (map-set pools goal-id
      {
        goal-id: goal-id,
        total-balance: u0,
        target-amount: target-amount,
        deadline: deadline,
        is-locked: false,
        token-type: token-type,
        active: true,
        creator: tx-sender
      }
    )
    (map-set pool-balances goal-id u0)
    (map-set locked-funds goal-id false)
    (var-set pool-count (+ (var-get pool-count) u1))
    (print { event: "pool-initialized", goal-id: goal-id })
    (ok goal-id)
  )
)

(define-public (deposit-stx
  (goal-id uint)
  (amount uint)
)
  (let (
    (pool-opt (map-get? pools goal-id))
    (pool (unwrap! pool-opt ERR-GOAL-NOT-FOUND))
    (new-balance (+ (get total-balance pool) amount))
  )
    (try! (validate-active-pool (some pool)))
    (try! (validate-amount amount))
    (asserts! (not (get is-locked pool)) ERR-GOAL-NOT-ACTIVE)
    (asserts! (<= block-height (get deadline pool)) ERR-DEADLINE-PASSED)
    (asserts! (is-eq (get token-type pool) "STX") ERR-INVALID-TOKEN)
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (map-set pools goal-id
      {
        goal-id: (get goal-id pool),
        total-balance: new-balance,
        target-amount: (get target-amount pool),
        deadline: (get deadline pool),
        is-locked: (get is-locked pool),
        token-type: (get token-type pool),
        active: (get active pool),
        creator: (get creator pool)
      }
    )
    (map-set pool-balances goal-id new-balance)
    (map-set contributions
      { goal-id: goal-id, contributor: tx-sender }
      {
        amount: (+ (default-to u0 (get amount (map-get? contributions { goal-id: goal-id, contributor: tx-sender }))) amount),
        timestamp: block-height,
        share-percentage: (calculate-share new-balance (get target-amount pool))
      }
    )
    (print { event: "stx-deposited", goal-id: goal-id, amount: amount })
    (ok new-balance)
  )
)

(define-public (deposit-ft
  (goal-id uint)
  (amount uint)
  (token-contract principal)
)
  (let (
    (pool-opt (map-get? pools goal-id))
    (pool (unwrap! pool-opt ERR-GOAL-NOT-FOUND))
    (token-str (principal-to-ascii token-contract))
    (new-balance (+ (get total-balance pool) amount))
  )
    (try! (validate-active-pool (some pool)))
    (try! (validate-amount amount))
    (asserts! (not (get is-locked pool)) ERR-GOAL-NOT-ACTIVE)
    (asserts! (<= block-height (get deadline pool)) ERR-DEADLINE-PASSED)
    (asserts! (is-eq (get token-type pool) token-str) ERR-INVALID-TOKEN)
    (try! (contract-call? token-contract transfer amount tx-sender (as-contract tx-sender) none))
    (map-set pools goal-id
      {
        goal-id: (get goal-id pool),
        total-balance: new-balance,
        target-amount: (get target-amount pool),
        deadline: (get deadline pool),
        is-locked: (get is-locked pool),
        token-type: (get token-type pool),
        active: (get active pool),
        creator: (get creator pool)
      }
    )
    (map-set pool-balances goal-id new-balance)
    (map-set contributions
      { goal-id: goal-id, contributor: tx-sender }
      {
        amount: (+ (default-to u0 (get amount (map-get? contributions { goal-id: goal-id, contributor: tx-sender }))) amount),
        timestamp: block-height,
        share-percentage: (calculate-share new-balance (get target-amount pool))
      }
    )
    (print { event: "ft-deposited", goal-id: goal-id, amount: amount })
    (ok new-balance)
  )
)

(define-private (calculate-share (balance uint) (target uint))
  (if (> target u0)
    (* u100 (/ balance target))
    u0
  )
)

(define-public (lock-pool (goal-id uint))
  (let (
    (pool-opt (map-get? pools goal-id))
    (pool (unwrap! pool-opt ERR-GOAL-NOT-FOUND))
  )
    (try! (validate-admin))
    (try! (validate-active-pool (some pool)))
    (asserts! (not (get is-locked pool)) ERR-LOCK-ALREADY-APPLIED)
    (map-set pools goal-id
      {
        goal-id: (get goal-id pool),
        total-balance: (get total-balance pool),
        target-amount: (get target-amount pool),
        deadline: (get deadline pool),
        is-locked: true,
        token-type: (get token-type pool),
        active: (get active pool),
        creator: (get creator pool)
      }
    )
    (map-set locked-funds goal-id true)
    (print { event: "pool-locked", goal-id: goal-id })
    (ok true)
  )
)

(define-public (unlock-pool (goal-id uint))
  (let (
    (pool-opt (map-get? pools goal-id))
    (pool (unwrap! pool-opt ERR-GOAL-NOT-FOUND))
  )
    (try! (validate-admin))
    (asserts! (get is-locked pool) ERR-GOAL-NOT-LOCKED)
    (map-set pools goal-id
      {
        goal-id: (get goal-id pool),
        total-balance: (get total-balance pool),
        target-amount: (get target-amount pool),
        deadline: (get deadline pool),
        is-locked: false,
        token-type: (get token-type pool),
        active: (get active pool),
        creator: (get creator pool)
      }
    )
    (map-set locked-funds goal-id false)
    (print { event: "pool-unlocked", goal-id: goal-id })
    (ok true)
  )
)

(define-public (withdraw-stx (goal-id uint) (amount uint))
  (let (
    (pool-opt (map-get? pools goal-id))
    (pool (unwrap! pool-opt ERR-GOAL-NOT-FOUND))
    (current-bal (get total-balance pool))
    (new-bal (- current-bal amount))
    (contrib-opt (map-get? contributions { goal-id: goal-id, contributor: tx-sender }))
    (contrib (unwrap! contrib-opt ERR-INSUFFICIENT-BALANCE))
  )
    (try! (validate-active-pool (some pool)))
    (try! (validate-amount amount))
    (asserts! (>= current-bal amount) ERR-INSUFFICIENT-BALANCE)
    (asserts! (>= (get amount contrib) amount) ERR-INSUFFICIENT-BALANCE)
    (asserts! (not (get is-locked pool)) ERR-GOAL-NOT-LOCKED)
    (asserts! (is-eq (get token-type pool) "STX") ERR-INVALID-TOKEN)
    (try! (as-contract (stx-transfer? amount tx-sender tx-sender)))
    (map-set pools goal-id
      {
        goal-id: (get goal-id pool),
        total-balance: new-bal,
        target-amount: (get target-amount pool),
        deadline: (get deadline pool),
        is-locked: (get is-locked pool),
        token-type: (get token-type pool),
        active: (get active pool),
        creator: (get creator pool)
      }
    )
    (map-set pool-balances goal-id new-bal)
    (map-set contributions
      { goal-id: goal-id, contributor: tx-sender }
      {
        amount: (- (get amount contrib) amount),
        timestamp: block-height,
        share-percentage: (calculate-share new-bal (get target-amount pool))
      }
    )
    (print { event: "stx-withdrawn", goal-id: goal-id, amount: amount })
    (ok new-bal)
  )
)

(define-public (withdraw-ft (goal-id uint) (amount uint) (token-contract principal))
  (let (
    (pool-opt (map-get? pools goal-id))
    (pool (unwrap! pool-opt ERR-GOAL-NOT-FOUND))
    (current-bal (get total-balance pool))
    (new-bal (- current-bal amount))
    (token-str (principal-to-ascii token-contract))
    (contrib-opt (map-get? contributions { goal-id: goal-id, contributor: tx-sender }))
    (contrib (unwrap! contrib-opt ERR-INSUFFICIENT-BALANCE))
  )
    (try! (validate-active-pool (some pool)))
    (try! (validate-amount amount))
    (asserts! (>= current-bal amount) ERR-INSUFFICIENT-BALANCE)
    (asserts! (>= (get amount contrib) amount) ERR-INSUFFICIENT-BALANCE)
    (asserts! (not (get is-locked pool)) ERR-GOAL-NOT-LOCKED)
    (asserts! (is-eq (get token-type pool) token-str) ERR-INVALID-TOKEN)
    (try! (as-contract (contract-call? token-contract transfer amount tx-sender tx-sender none)))
    (map-set pools goal-id
      {
        goal-id: (get goal-id pool),
        total-balance: new-bal,
        target-amount: (get target-amount pool),
        deadline: (get deadline pool),
        is-locked: (get is-locked pool),
        token-type: (get token-type pool),
        active: (get active pool),
        creator: (get creator pool)
      }
    )
    (map-set pool-balances goal-id new-bal)
    (map-set contributions
      { goal-id: goal-id, contributor: tx-sender }
      {
        amount: (- (get amount contrib) amount),
        timestamp: block-height,
        share-percentage: (calculate-share new-bal (get target-amount pool))
      }
    )
    (print { event: "ft-withdrawn", goal-id: goal-id, amount: amount })
    (ok new-bal)
  )
)

(define-public (deactivate-pool (goal-id uint))
  (let (
    (pool-opt (map-get? pools goal-id))
    (pool (unwrap! pool-opt ERR-GOAL-NOT-FOUND))
  )
    (try! (validate-admin))
    (try! (validate-active-pool (some pool)))
    (map-set pools goal-id
      {
        goal-id: (get goal-id pool),
        total-balance: (get total-balance pool),
        target-amount: (get target-amount pool),
        deadline: (get deadline pool),
        is-locked: (get is-locked pool),
        token-type: (get token-type pool),
        active: false,
        creator: (get creator pool)
      }
    )
    (print { event: "pool-deactivated", goal-id: goal-id })
    (ok true)
  )
)

(define-public (set-oracle (new-oracle principal))
  (begin
    (try! (validate-admin))
    (var-set oracle new-oracle)
    (print { event: "oracle-set", oracle: new-oracle })
    (ok true)
  )
)

(define-public (set-deposit-fee (fee uint))
  (begin
    (try! (validate-admin))
    (asserts! (<= fee u1000) ERR-INVALID-AMOUNT)
    (var-set deposit-fee fee)
    (print { event: "deposit-fee-set", fee: fee })
    (ok true)
  )
)

(define-public (get-pool-progress (goal-id uint))
  (let (
    (pool-opt (map-get? pools goal-id))
    (pool (unwrap! pool-opt ERR-GOAL-NOT-FOUND))
    (bal (get total-balance pool))
    (target (get target-amount pool))
    (progress (if (> target u0) (* u100 (/ bal target)) u0))
  )
    (ok { balance: bal, target: target, progress: progress, locked: (get is-locked pool) })
  )
)
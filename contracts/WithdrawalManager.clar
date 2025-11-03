(define-constant ERR-NOT-OWNER u200)
(define-constant ERR-GOAL-NOT-FOUND u201)
(define-constant ERR-GOAL-NOT-ACHIEVED u202)
(define-constant ERR-GOAL-ACHIEVED u203)
(define-constant ERR-INVALID-VOTE u204)
(define-constant ERR-VOTING-NOT-OPEN u205)
(define-constant ERR-ALREADY-VOTED u206)
(define-constant ERR-INSUFFICIENT-VOTES u207)
(define-constant ERR-TIME-LOCK-NOT-EXPIRED u208)
(define-constant ERR-INVALID-PAYOUT-AMOUNT u209)
(define-constant ERR-REFUND-NOT-AUTHORIZED u210)
(define-constant ERR-ORACLE-NOT-VERIFIED u211)
(define-constant ERR-MULTI-SIG-FAILED u212)
(define-constant ERR-WITHDRAWAL-EXECUTED u213)
(define-constant ERR-INVALID-GOAL-STATUS u214)
(define-constant ERR-MIN-VOTERS-NOT-MET u215)
(define-constant ERR-PAYOUT-CLAIMED u216)

(define-data-var admin principal tx-sender)
(define-data-var oracle-principal (optional principal) none)
(define-data-var min-voting-threshold uint u51)
(define-data-var time-lock-duration uint u100)
(define-data-var max-voters uint u20)

(define-map goal-status
  uint
  {
    target-amount: uint,
    current-balance: uint,
    deadline: uint,
    achieved: bool,
    refunded: bool,
    payout-claimed: bool
  }
)

(define-map withdrawal-votes
  { goal-id: uint, voter: principal }
  bool
)

(define-map withdrawal-requests
  uint
  {
    goal-id: uint,
    requester: principal,
    reason: (string-utf8 200),
    votes-for: uint,
    votes-against: uint,
    total-voters: uint,
    voting-deadline: uint,
    executed: bool,
    refund-amount: uint
  }
)

(define-map participant-shares
  { goal-id: uint, participant: principal }
  uint
)

(define-map claimed-payouts
  { goal-id: uint, claimant: principal }
  bool
)

(define-read-only (get-goal-status (goal-id uint))
  (map-get? goal-status goal-id)
)

(define-read-only (get-withdrawal-request (goal-id uint))
  (map-get? withdrawal-requests goal-id)
)

(define-read-only (get-participant-share (goal-id uint) (participant principal))
  (map-get? participant-shares { goal-id: goal-id, participant: participant })
)

(define-read-only (get-vote-status (goal-id uint) (voter principal))
  (map-get? withdrawal-votes { goal-id: goal-id, voter: voter })
)

(define-read-only (is-admin)
  (is-eq tx-sender (var-get admin))
)

(define-read-only (is-verified-oracle)
  (match (var-get oracle-principal)
    some-oracle (is-eq tx-sender some-oracle)
    false
  )
)

(define-private (validate-goal-id (goal-id uint))
  (if (> goal-id u0)
    (ok true)
    (err ERR-GOAL-NOT-FOUND)
  )
)

(define-private (validate-goal-achieved (status (optional { target-amount: uint, current-balance: uint, deadline: uint, achieved: bool, refunded: bool, payout-claimed: bool })))
  (match status
    some-s (if (and (get achieved some-s) (not (get payout-claimed some-s)))
      (ok true)
      (err ERR-GOAL-NOT-ACHIEVED)
    )
    (err ERR-GOAL-NOT-FOUND)
  )
)

(define-private (validate-goal-failed (status (optional { target-amount: uint, current-balance: uint, deadline: uint, achieved: bool, refunded: bool, payout-claimed: bool })))
  (match status
    some-s (if (and (not (get achieved some-s)) (not (get refunded some-s)) (>= block-height (get deadline some-s)))
      (ok true)
      (err ERR-GOAL-NOT-ACHIEVED)
    )
    (err ERR-GOAL-NOT-FOUND)
  )
)

(define-private (validate-voting-open (req { goal-id: uint, requester: principal, reason: (string-utf8 200), votes-for: uint, votes-against: uint, total-voters: uint, voting-deadline: uint, executed: bool, refund-amount: uint }))
  (if (and (not (get executed req)) (< block-height (get voting-deadline req)))
    (ok true)
    (err ERR-VOTING-NOT-OPEN)
  )
)

(define-private (validate-vote-amount (vote-amount uint))
  (if (and (> vote-amount u0) (<= vote-amount (var-get max-voters)))
    (ok true)
    (err ERR-INVALID-VOTE)
  )
)

(define-private (update-vote-count (goal-id uint) (for-vote bool))
  (let ((req-opt (map-get? withdrawal-requests goal-id)))
    (match req-opt
      some-req (let ((new-for (if for-vote (+ (get votes-for some-req) u1) (get votes-for some-req)))
                     (new-against (if for-vote (get votes-against some-req) (+ (get votes-against some-req) u1))))
                 (map-set withdrawal-requests goal-id
                   {
                     goal-id: goal-id,
                     requester: (get requester some-req),
                     reason: (get reason some-req),
                     votes-for: new-for,
                     votes-against: new-against,
                     total-voters: (+ (get total-voters some-req) u1),
                     voting-deadline: (get voting-deadline some-req),
                     executed: false,
                     refund-amount: (get refund-amount some-req)
                   }
                 )
                 (ok true)
               )
      (err ERR-GOAL-NOT-FOUND)
    )
  )
)

(define-private (check-voting-threshold (votes-for uint) (total-voters uint))
  (let ((threshold (* (var-get min-voting-threshold) total-voters)))
    (if (> (* votes-for u100) threshold)
      (ok true)
      (err ERR-INSUFFICIENT-VOTES)
    )
  )
)

(define-private (transfer-proportional-payout (goal-id uint) (claimant principal) (share uint) (total-balance uint))
  (let ((payout-amount (/ (* share total-balance) u100)))
    (if (> payout-amount u0)
      (as-contract (stx-transfer? payout-amount tx-sender claimant))
      (err ERR-INVALID-PAYOUT-AMOUNT)
    )
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-admin) (err ERR-NOT-OWNER))
    (var-set admin new-admin)
    (ok true)
  )
)

(define-public (set-oracle (oracle principal))
  (begin
    (asserts! (is-admin) (err ERR-NOT-OWNER))
    (var-set oracle-principal (some oracle))
    (ok true)
  )
)

(define-public (set-min-voting-threshold (threshold uint))
  (begin
    (asserts! (is-admin) (err ERR-NOT-OWNER))
    (asserts! (and (> threshold u0) (<= threshold u100)) (err ERR-INVALID-VOTE))
    (var-set min-voting-threshold threshold)
    (ok true)
  )
)

(define-public (set-time-lock-duration (duration uint))
  (begin
    (asserts! (is-admin) (err ERR-NOT-OWNER))
    (asserts! (> duration u0) (err ERR-INVALID-VOTE))
    (var-set time-lock-duration duration)
    (ok true)
  )
)

(define-public (set-max-voters (max uint))
  (begin
    (asserts! (is-admin) (err ERR-NOT-OWNER))
    (asserts! (> max u0) (err ERR-INVALID-VOTE))
    (var-set max-voters max)
    (ok true)
  )
)

(define-public (update-goal-status (goal-id uint) (target uint) (current uint) (deadline uint) (achieved bool))
  (begin
    (try! (validate-goal-id goal-id))
    (asserts! (is-verified-oracle) (err ERR-ORACLE-NOT-VERIFIED))
    (map-set goal-status goal-id
      {
        target-amount: target,
        current-balance: current,
        deadline: deadline,
        achieved: achieved,
        refunded: false,
        payout-claimed: false
      }
    )
    (ok true)
  )
)

(define-public (initiate-refund (goal-id uint) (reason (string-utf8 200)) (refund-amount uint))
  (let ((status-opt (get-goal-status goal-id)))
    (begin
      (try! (validate-goal-id goal-id))
      (try! (validate-goal-failed status-opt))
      (asserts! (not (is-some (get-withdrawal-request goal-id))) (err ERR-WITHDRAWAL-EXECUTED))
      (asserts! (<= refund-amount (get current-balance (unwrap-panic status-opt))) (err ERR-INVALID-PAYOUT-AMOUNT))
      (map-set withdrawal-requests goal-id
        {
          goal-id: goal-id,
          requester: tx-sender,
          reason: reason,
          votes-for: u0,
          votes-against: u0,
          total-voters: u0,
          voting-deadline: (+ block-height (var-get time-lock-duration)),
          executed: false,
          refund-amount: refund-amount
        }
      )
      (print { event: "refund-initiated", goal-id: goal-id })
      (ok true)
    )
  )
)

(define-public (vote-on-withdrawal (goal-id uint) (vote-for bool))
  (let ((req-opt (get-withdrawal-request goal-id))
        (vote-key { goal-id: goal-id, voter: tx-sender })
        (existing-vote (get-vote-status goal-id tx-sender)))
    (begin
      (try! (validate-goal-id goal-id))
      (asserts! (is-some req-opt) (err ERR-GOAL-NOT-FOUND))
      (try! (validate-voting-open (unwrap-panic req-opt)))
      (asserts! (not (is-some existing-vote)) (err ERR-ALREADY-VOTED))
      (map-set withdrawal-votes vote-key vote-for)
      (try! (update-vote-count goal-id vote-for))
      (print { event: "vote-cast", goal-id: goal-id, vote-for: vote-for })
      (ok true)
    )
  )
)

(define-public (execute-withdrawal (goal-id uint))
  (let ((req-opt (get-withdrawal-request goal-id))
        (req (unwrap! req-opt ERR-GOAL-NOT-FOUND))
        (status-opt (get-goal-status goal-id))
        (status (unwrap! status-opt ERR-GOAL-NOT-FOUND))
        (votes-for (get votes-for req))
        (total-voters (get total-voters req)))
    (begin
      (try! (validate-goal-id goal-id))
      (asserts! (>= block-height (get voting-deadline req)) (err ERR-TIME-LOCK-NOT-EXPIRED))
      (try! (check-voting-threshold votes-for total-voters))
      (asserts! (not (get executed req)) (err ERR-WITHDRAWAL-EXECUTED))
      (map-set withdrawal-requests goal-id
        {
          goal-id: (get goal-id req),
          requester: (get requester req),
          reason: (get reason req),
          votes-for: (get votes-for req),
          votes-against: (get votes-against req),
          total-voters: (get total-voters req),
          voting-deadline: (get voting-deadline req),
          executed: true,
          refund-amount: (get refund-amount req)
        }
      )
      (map-set goal-status goal-id
        {
          target-amount: (get target-amount status),
          current-balance: (get current-balance status),
          deadline: (get deadline status),
          achieved: (get achieved status),
          refunded: true,
          payout-claimed: (get payout-claimed status)
        }
      )
      (let ((refund-amt (get refund-amount req)))
        (if (> refund-amt u0)
          (begin
            (try! (as-contract (stx-transfer? refund-amt tx-sender (get requester req))))
            (print { event: "refund-executed", goal-id: goal-id, amount: refund-amt })
          )
          (ok true)
        )
      )
      (ok true)
    )
  )
)

(define-public (claim-payout (goal-id uint))
  (let ((status-opt (get-goal-status goal-id))
        (status (unwrap! status-opt ERR-GOAL-NOT-FOUND))
        (claim-key { goal-id: goal-id, claimant: tx-sender })
        (share-opt (get-participant-share goal-id tx-sender))
        (share (unwrap! share-opt u0))
        (total-balance (get current-balance status)))
    (begin
      (try! (validate-goal-id goal-id))
      (try! (validate-goal-achieved status-opt))
      (asserts! (not (get payout-claimed status)) (err ERR-PAYOUT-CLAIMED))
      (asserts! (not (is-some (map-get? claimed-payouts claim-key))) (err ERR-PAYOUT-CLAIMED))
      (asserts! (> share u0) (err ERR-INVALID-PAYOUT-AMOUNT))
      (try! (transfer-proportional-payout goal-id tx-sender share total-balance))
      (map-set claimed-payouts claim-key true)
      (map-set goal-status goal-id
        {
          target-amount: (get target-amount status),
          current-balance: (get current-balance status),
          deadline: (get deadline status),
          achieved: (get achieved status),
          refunded: (get refunded status),
          payout-claimed: true
        }
      )
      (print { event: "payout-claimed", goal-id: goal-id, claimant: tx-sender, share: share })
      (ok true)
    )
  )
)

(define-public (set-participant-share (goal-id uint) (participant principal) (share uint))
  (begin
    (try! (validate-goal-id goal-id))
    (asserts! (is-admin) (err ERR-NOT-OWNER))
    (asserts! (> share u0) (err ERR-INVALID-PAYOUT-AMOUNT))
    (map-set participant-shares { goal-id: goal-id, participant: participant } share)
    (ok true)
  )
)
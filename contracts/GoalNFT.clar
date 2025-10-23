(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-GOAL-ID u101)
(define-constant ERR-INVALID-TARGET-AMOUNT u102)
(define-constant ERR-INVALID-DEADLINE u103)
(define-constant ERR-INVALID-PARTICIPANT u104)
(define-constant ERR-GOAL-ALREADY-EXISTS u105)
(define-constant ERR-GOAL-NOT-FOUND u106)
(define-constant ERR-INVALID-METADATA u107)
(define-constant ERR-TRANSFER-NOT-ALLOWED u108)
(define-constant ERR-CONSENSUS-REQUIRED u109)
(define-constant ERR-MAX-GOALS-EXCEEDED u110)
(define-constant ERR-INVALID-STATUS u111)
(define-constant ERR-INVALID-NFT-INDEX u112)
(define-constant ERR-INVALID-CURRENCY u113)
(define-constant ERR-INVALID-PARTICIPANT-COUNT u114)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u115)

(define-data-var next-goal-id uint u0)
(define-data-var max-goals uint u1000)
(define-data-var creation-fee uint u1000)
(define-data-var authority-contract (optional principal) none)

(define-map goals
  uint
  {
    name: (string-utf8 100),
    target-amount: uint,
    deadline: uint,
    creator: principal,
    status: (string-utf8 20),
    currency: (string-utf8 20),
    participant-count: uint,
    metadata: (string-utf8 256),
    participants: (list 50 principal)
  }
)

(define-map goal-nfts
  uint
  {
    owner: principal,
    goal-id: uint
  }
)

(define-map goals-by-name
  (string-utf8 100)
  uint)

(define-trait sip-009-nft
  (
    (transfer (uint principal principal) (response bool uint))
    (get-owner (uint) (response (optional principal) uint))
    (get-token-uri (uint) (response (optional (string-utf8 256)) uint))
  )
)

(define-read-only (get-goal (goal-id uint))
  (map-get? goals goal-id)
)

(define-read-only (get-goal-nft (nft-id uint))
  (map-get? goal-nfts nft-id)
)

(define-read-only (get-goal-by-name (name (string-utf8 100)))
  (match (map-get? goals-by-name name)
    goal-id (map-get? goals goal-id)
    none
  )
)

(define-read-only (get-goal-count)
  (var-get next-goal-id)
)

(define-read-only (is-goal-registered (name (string-utf8 100)))
  (is-some (map-get? goals-by-name name))
)

(define-private (validate-name (name (string-utf8 100)))
  (if (and (> (len name) u0) (<= (len name) u100))
    (ok true)
    (err ERR-INVALID-METADATA)
  )
)

(define-private (validate-target-amount (amount uint))
  (if (> amount u0)
    (ok true)
    (err ERR-INVALID-TARGET-AMOUNT)
  )
)

(define-private (validate-deadline (deadline uint))
  (if (> deadline block-height)
    (ok true)
    (err ERR-INVALID-DEADLINE)
  )
)

(define-private (validate-participant (participant principal))
  (if (not (is-eq participant 'SP000000000000000000002Q6VF78))
    (ok true)
    (err ERR-INVALID-PARTICIPANT)
  )
)

(define-private (validate-currency (currency (string-utf8 20)))
  (if (or (is-eq currency "STX") (is-eq currency "USD"))
    (ok true)
    (err ERR-INVALID-CURRENCY)
  )
)

(define-private (validate-participant-count (count uint))
  (if (and (> count u0) (<= count u50))
    (ok true)
    (err ERR-INVALID-PARTICIPANT-COUNT)
  )
)

(define-private (validate-metadata (metadata (string-utf8 256)))
  (if (<= (len metadata) u256)
    (ok true)
    (err ERR-INVALID-METADATA)
  )
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (not (is-eq contract-principal 'SP000000000000000000002Q6VF78)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (create-goal
  (name (string-utf8 100))
  (target-amount uint)
  (deadline uint)
  (currency (string-utf8 20))
  (metadata (string-utf8 256))
  (participants (list 50 principal))
)
  (let
    (
      (goal-id (var-get next-goal-id))
      (nft-id goal-id)
      (authority (var-get authority-contract))
    )
    (asserts! (< goal-id (var-get max-goals)) (err ERR-MAX-GOALS-EXCEEDED))
    (try! (validate-name name))
    (try! (validate-target-amount target-amount))
    (try! (validate-deadline deadline))
    (try! (validate-currency currency))
    (try! (validate-metadata metadata))
    (try! (validate-participant-count (len participants)))
    (map validate-participant participants)
    (asserts! (is-none (map-get? goals-by-name name)) (err ERR-GOAL-ALREADY-EXISTS))
    (asserts! (is-some authority) (err ERR-AUTHORITY-NOT-VERIFIED))
    (try! (stx-transfer? (var-get creation-fee) tx-sender (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
    (map-set goals goal-id
      {
        name: name,
        target-amount: target-amount,
        deadline: deadline,
        creator: tx-sender,
        status: "active",
        currency: currency,
        participant-count: (len participants),
        metadata: metadata,
        participants: participants
      }
    )
    (map-set goal-nfts nft-id
      {
        owner: tx-sender,
        goal-id: goal-id
      }
    )
    (map-set goals-by-name name goal-id)
    (var-set next-goal-id (+ goal-id u1))
    (print { event: "goal-created", goal-id: goal-id, nft-id: nft-id })
    (ok nft-id)
  )
)

(define-public (transfer-goal-nft
  (nft-id uint)
  (recipient principal)
)
  (let
    (
      (nft (map-get? goal-nfts nft-id))
    )
    (match nft
      nft-data
      (begin
        (asserts! (is-eq (get owner nft-data) tx-sender) (err ERR-NOT-AUTHORIZED))
        (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) (err ERR-INVALID-PARTICIPANT))
        (let
          (
            (goal-id (get goal-id nft-data))
            (goal (unwrap! (map-get? goals goal-id) (err ERR-GOAL-NOT-FOUND)))
          )
          (asserts! (is-eq (get status goal) "active") (err ERR-INVALID-STATUS))
          (map-set goal-nfts nft-id
            {
              owner: recipient,
              goal-id: goal-id
            }
          )
          (print { event: "nft-transferred", nft-id: nft-id, recipient: recipient })
          (ok true)
        )
      )
      (err ERR-INVALID-NFT-INDEX)
    )
  )
)

(define-public (update-goal-metadata
  (goal-id uint)
  (new-metadata (string-utf8 256))
)
  (let
    (
      (goal (map-get? goals goal-id))
    )
    (match goal
      goal-data
      (begin
        (asserts! (is-eq (get creator goal-data) tx-sender) (err ERR-NOT-AUTHORIZED))
        (asserts! (is-eq (get status goal-data) "active") (err ERR-INVALID-STATUS))
        (try! (validate-metadata new-metadata))
        (map-set goals goal-id
          {
            name: (get name goal-data),
            target-amount: (get target-amount goal-data),
            deadline: (get deadline goal-data),
            creator: (get creator goal-data),
            status: (get status goal-data),
            currency: (get currency goal-data),
            participant-count: (get participant-count goal-data),
            metadata: new-metadata,
            participants: (get participants goal-data)
          }
        )
        (print { event: "metadata-updated", goal-id: goal-id })
        (ok true)
      )
      (err ERR-GOAL-NOT-FOUND)
    )
  )
)

(define-public (add-participant
  (goal-id uint)
  (new-participant principal)
)
  (let
    (
      (goal (map-get? goals goal-id))
    )
    (match goal
      goal-data
      (begin
        (asserts! (is-eq (get creator goal-data) tx-sender) (err ERR-NOT-AUTHORIZED))
        (asserts! (< (get participant-count goal-data) u50) (err ERR-INVALID-PARTICIPANT-COUNT))
        (try! (validate-participant new-participant))
        (asserts! (is-eq (get status goal-data) "active") (err ERR-INVALID-STATUS))
        (let
          (
            (new-participants (unwrap! (as-max-len? (append (get participants goal-data) new-participant) u50) (err ERR-INVALID-PARTICIPANT-COUNT)))
          )
          (map-set goals goal-id
            {
              name: (get name goal-data),
              target-amount: (get target-amount goal-data),
              deadline: (get deadline goal-data),
              creator: (get creator goal-data),
              status: (get status goal-data),
              currency: (get currency goal-data),
              participant-count: (+ (get participant-count goal-data) u1),
              metadata: (get metadata goal-data),
              participants: new-participants
            }
          )
          (print { event: "participant-added", goal-id: goal-id, participant: new-participant })
          (ok true)
        )
      )
      (err ERR-GOAL-NOT-FOUND)
    )
  )
)

(define-public (set-goal-status
  (goal-id uint)
  (new-status (string-utf8 20))
)
  (let
    (
      (goal (map-get? goals goal-id))
    )
    (match goal
      goal-data
      (begin
        (asserts! (is-eq (get creator goal-data) tx-sender) (err ERR-NOT-AUTHORIZED))
        (asserts! (or (is-eq new-status "active") (is-eq new-status "completed") (is-eq new-status "cancelled")) (err ERR-INVALID-STATUS))
        (map-set goals goal-id
          {
            name: (get name goal-data),
            target-amount: (get target-amount goal-data),
            deadline: (get deadline goal-data),
            creator: (get creator goal-data),
            status: new-status,
            currency: (get currency goal-data),
            participant-count: (get participant-count goal-data),
            metadata: (get metadata goal-data),
            participants: (get participants goal-data)
          }
        )
        (print { event: "status-updated", goal-id: goal-id, status: new-status })
        (ok true)
      )
      (err ERR-GOAL-NOT-FOUND)
    )
  )
)
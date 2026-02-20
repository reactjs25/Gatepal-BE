# GatePal Visitor Flow Documentation

> Complete guide for Frontend Developers and QA Testers

---

## Table of Contents

1. [Overview](#overview)
2. [Visitor Types](#visitor-types)
3. [Request Statuses](#request-statuses)
4. [Flow 1: Member Invites Guest (WITH QR Code)](#flow-1-member-invites-guest-with-qr-code)
5. [Flow 2: Walk-in Visitor (WITHOUT QR Code)](#flow-2-walk-in-visitor-without-qr-code)
6. [Flow 3: Pre-Approved Delivery](#flow-3-pre-approved-delivery)
7. [Flow 4: Pre-Approved Taxi Driver](#flow-4-pre-approved-taxi-driver)
8. [Flow 5: Pre-Approved Other Visitor (Service Provider)](#flow-5-pre-approved-other-visitor-service-provider)
9. [Flow 6: Onboarded/Registered Visitor](#flow-6-onboardedregistered-visitor)
10. [Complete API Reference](#complete-api-reference)

---

## Overview

GatePal handles different types of visitors entering a society. The system supports:

- **Pre-invited guests** (Member creates invite → Guest gets QR → Guard scans QR)
- **Walk-in visitors** (Visitor arrives without QR → Guard creates entry request → Member approves)
- **Pre-approved visitors** (Member pre-approves delivery/taxi/other → Auto-approved on arrival)
- **Onboarded visitors** (Registered visitors with their own QR code)

---

## Visitor Types

| Type | Code | Description |
|------|------|-------------|
| Guest | `guest` | Regular guest invited by member |
| Delivery Executive | `delivery_executive` | Delivery persons (Swiggy, Zomato, etc.) |
| Taxi/Cab Driver | `taxi_vehicle_driver` | Uber, Ola, Meru drivers |
| Other Visitor | `other_visitor` | Service providers (plumber, electrician, etc.) |

---

## Request Statuses

| Status | Description |
|--------|-------------|
| `pending` | Awaiting member approval (30-min expiry) |
| `approved` | Member approved, waiting for guard to allow entry |
| `rejected` | Member rejected entry (with reason) |
| `entered` | Visitor is inside society |
| `left` | Visitor has exited society |
| `cancelled` | Request was cancelled |
| `expired` | Request expired (timeout or invite validity ended) |
| `wrong_entry` | Member marked as wrong entry |

---

## Flow 1: Member Invites Guest (WITH QR Code)

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              MEMBER SIDE (INVITE CREATION)                          │
└─────────────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────────────┐
                    │         MEMBER WANTS TO INVITE          │
                    │              A GUEST                    │
                    └────────────────────┬────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
│      QUICK INVITE       │ │    FREQUENT INVITE      │ │      GROUP INVITE       │
│                         │ │                         │ │                         │
│ One-time visit          │ │ Recurring visitor       │ │ Party/Event             │
│ e.g., Friend visiting   │ │ e.g., Maid, Cook        │ │ Multiple guests         │
│                         │ │                         │ │ Single QR for all       │
└────────────┬────────────┘ └────────────┬────────────┘ └────────────┬────────────┘
             │                           │                           │
             ▼                           ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
│ POST /member/           │ │ POST /member/           │ │ POST /member/           │
│   guestInvites/quick    │ │   guestInvites/frequent │ │   guestInvites/group    │
└────────────┬────────────┘ └────────────┬────────────┘ └────────────┬────────────┘
             │                           │                           │
             └───────────────────────────┼───────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              API RESPONSE CONTAINS                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  {                                                                                  │
│    "inviteId": "...",                                                               │
│    "guests": [                                                                      │
│      {                                                                              │
│        "guestId": "...",                                                            │
│        "name": "Guest Name",                                                        │
│        "qrCodeBase64": "data:image/png;base64,...",  ← QR Code Image                │
│        "shareMessage": "You're invited to..."        ← Ready to share text         │
│      }                                                                              │
│    ]                                                                                │
│  }                                                                                  │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         MEMBER SHARES QR WITH GUEST                                 │
│                                                                                     │
│  Options:                                                                           │
│  • WhatsApp (shareMessage includes QR image)                                        │
│  • SMS (shareMessage with link)                                                     │
│  • In-person (show QR on phone)                                                     │
│  • Email                                                                            │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         │
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                 GUARD SIDE                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           GUEST ARRIVES AT GATE                                     │
│                           (Shows QR to Guard)                                       │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          GUARD SCANS QR CODE                                        │
│                     POST /guard/scanGuestInvite                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  Request Body:                                                                      │
│  {                                                                                  │
│    "qrPayload": "{ QR content as text }"  OR                                        │
│    "qrImageUrl": "data:image/png;base64,..." OR "https://..."                       │
│  }                                                                                  │
│                                                                                     │
│  System Validations:                                                                │
│  ✓ Is invite active? (not cancelled/expired)                                        │
│  ✓ Is current time within validity window?                                          │
│  ✓ For Quick: Has this specific guest already arrived?                              │
│  ✓ For Frequent: Is guest already inside society?                                   │
│  ✓ For Group: Are entries remaining (maxEntries)?                                   │
│                                                                                     │
│  On Success:                                                                        │
│  • Creates GuestEntryRequest with status = "approved"                               │
│  • Marks guest as hasArrived = true                                                 │
│  • Logs entry in invite.entryLogs                                                   │
│  • PRE-APPROVED via QR (guard must call allowEntry to mark as entered)              │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                       API RESPONSE                                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  {                                                                                  │
│    "requestId": "...",                                                              │
│    "status": "approved",             ← Guest is pre-approved, guard must allow entry│
│    "name": "Guest Name",                                                            │
│    "phoneNumber": "+91...",                                                         │
│    "photoRequired": true/false,      ← Guard should capture photo if true           │
│    "existingPhoto": "https://...",   ← Use existing if available                    │
│    "unitInfo": { "building": "A", "flatNumber": "101" }                             │
│  }                                                                                  │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
                           ┌─────────────┴─────────────┐
                           │    photoRequired: true?   │
                           └─────────────┬─────────────┘
                                   │           │
                              YES  │           │  NO
                                   ▼           ▼
              ┌─────────────────────────┐    ┌─────────────────────────┐
              │  GUARD CAPTURES PHOTO   │    │    SKIP PHOTO STEP      │
              │  & ADDS ENTRY DETAILS   │    │                         │
              └────────────┬────────────┘    └────────────┬────────────┘
                           │                              │
                           ▼                              │
              ┌─────────────────────────┐                 │
              │ POST /guard/entryDetails│                 │
              ├─────────────────────────┤                 │
              │ {                       │                 │
              │   "inviteId": "...",    │                 │
              │   "guestId": "...",     │                 │
              │   "imageUrl": "...",    │                 │
              │   "guestName": "...",   │                 │
              │   "phoneNumber": "...", │                 │
              │   "countryCode": "+91", │                 │
              │   "vehicleNumber": "",  │                 │
              │   "accompanyingCount":1 │                 │
              │ }                       │                 │
              └────────────┬────────────┘                 │
                           │                              │
                           └──────────────┬───────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         ENTRY DETAILS RESPONSE                                      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  {                                                                                  │
│    "requestId": "...",        ← GuestEntryRequest id for allowEntry/allowExit    │
│    "inviteId": "...",                                                          │
│    "arrivingGuest": { ... },                                                      │
│    "vehicleNumber": "...",                                                      │
│    "accompanyingCount": 1                                                         │
│  }                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘

                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         GUARD ALLOWS ENTRY                                          │
│              POST /guard/guestEntryRequests/allowEntry                              │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Request: { "requestId": "..." }                                                    │
│                                                                                     │
│  → status changes from "approved" to "entered"                                      │
│  → Guest is now inside the society                                                  │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            GUEST IS NOW INSIDE                                      │
│                          status = "entered"                                         │
│                                                                                     │
│  Member can see guest entry in their app                                            │
│  Guard can see guest in "Currently Inside" list                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         │  (Guest is leaving)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          GUARD MARKS EXIT                                           │
│              POST /guard/guestEntryRequests/allowExit                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Request: { "requestId": "..." }  OR  { "requestIds": ["...", "..."] }              │
│                                                                                     │
│  Response: status = "left"                                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Invite Type Comparison

| Feature | Quick Invite | Private Invite | Frequent Invite | Group Invite |
|---------|--------------|----------------|-----------------|--------------|
| **Endpoint** | POST /member/guestInvites/quick | POST /member/guestInvites/quick | POST /member/guestInvites/frequent | POST /member/guestInvites/group |
| **Special Flag** | - | `isPrivateInvite: true` | - | - |
| **QR Codes** | 1 per guest | 1 per guest | 1 per guest | 1 for entire group |
| **Max Entries** | = Number of guests | = Number of guests | Unlimited | Custom `maxEntries` |
| **Validity** | Hours or until time | Hours or until time | 1 week/1 month/custom | Max 24 hours |
| **Re-entry** | ❌ No | ❌ No | ✅ Yes (if exited) | ✅ Yes (if under limit) |
| **Use Case** | One-time visit | Hide from logs | Domestic help | Party/Event |

### Quick Invite Request Body

```json
POST /member/guestInvites/quick

{
  "guests": [
    {
      "name": "John Doe",
      "phoneNumber": "+919876543210",
      "imageUrl": "https://..." // optional
    }
  ],
  "isPrivateInvite": false,
  "validityHours": 4,           // OR use validTillTime
  "validTillTime": "2024-01-15T18:00:00.000Z"
}
```

### Frequent Invite Request Body

```json
POST /member/guestInvites/frequent

{
  "guests": [
    {
      "name": "Sunita (Maid)",
      "phoneNumber": "+919876543210",
      "imageUrl": "https://..."
    }
  ],
  "validityType": "1_week",     // "1_week" | "1_month" | "custom"
  "validFrom": "2024-01-15T00:00:00.000Z",    // for custom
  "validTill": "2024-03-15T23:59:59.000Z"     // for custom
}
```

### Group Invite Request Body

```json
POST /member/guestInvites/group

{
  "partyName": "Birthday Party",
  "expectedGuestCount": 20,
  "maxEntries": 25,
  "date": "2024-01-20",
  "startTime": "18:00",
  "validityHours": 6
}
```

---

## Flow 2: Walk-in Visitor (WITHOUT QR Code)

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           VISITOR ARRIVES AT GATE                                   │
│                              (No QR Code)                                           │
│                                                                                     │
│  Examples:                                                                          │
│  • Friend visiting without prior invite                                             │
│  • Delivery person (no pre-approval)                                                │
│  • Service provider (plumber, electrician)                                          │
│  • Taxi driver dropping someone                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      GUARD CREATES ENTRY REQUEST                                    │
│                     POST /guard/guestEntryRequests                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  Request Body:                                                                      │
│  {                                                                                  │
│    "name": "Visitor Name",                                                          │
│    "phoneNumber": "+919876543210",                                                  │
│    "imageUrl": "data:image/jpeg;base64,...",   ← Guard captures photo               │
│    "visitorType": "guest",                     ← See visitor types below            │
│    "vehicleNumber": "MH01AB1234",              ← Optional                           │
│    "accompanyingCount": 1,                     ← Default 1                          │
│    "unitId": "...",                            ← Which flat visiting                │
│    "gateId": "..."                             ← Entry gate                         │
│  }                                                                                  │
│                                                                                     │
│  For Delivery:                                                                      │
│  {                                                                                  │
│    ...                                                                              │
│    "visitorType": "delivery_executive",                                             │
│    "companyId": "...",                         ← Swiggy, Zomato, etc.               │
│    "companyName": "Swiggy"                                                          │
│  }                                                                                  │
│                                                                                     │
│  For Other Visitor (Service Provider):                                              │
│  {                                                                                  │
│    ...                                                                              │
│    "visitorType": "other_visitor",                                                  │
│    "companyId": "...",                                                              │
│    "companyName": "Urban Company",                                                  │
│    "workCategory": "plumbing"                                                       │
│  }                                                                                  │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
              ┌──────────────────────────┴──────────────────────────┐
              │           SYSTEM CHECKS FOR PRE-APPROVAL            │
              │                                                     │
              │  Does a matching pre-approval exist?                │
              │  • Delivery: matching company                       │
              │  • Taxi: matching company + vehicle                 │
              │  • Other: matching work category + company          │
              └──────────────────────────┬──────────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │ YES                │                    │ NO
                    ▼                    │                    ▼
┌───────────────────────────────┐        │    ┌───────────────────────────────┐
│       AUTO-APPROVED!          │        │    │     PENDING APPROVAL          │
│   status = "approved"         │        │    │    status = "pending"         │
│                               │        │    │                               │
│   Pre-approval matched        │        │    │   30-minute expiry timer      │
│   No member action needed     │        │    │   starts now                  │
└──────────────┬────────────────┘        │    └──────────────┬────────────────┘
               │                         │                   │
               │                         │                   ▼
               │                         │    ┌───────────────────────────────┐
               │                         │    │  PUSH NOTIFICATION SENT TO    │
               │                         │    │  ALL UNIT RESIDENTS           │
               │                         │    ├───────────────────────────────┤
               │                         │    │  "Visitor Name wants to       │
               │                         │    │   visit your unit"            │
               │                         │    └──────────────┬────────────────┘
               │                         │                   │
               │                         │                   ▼
               │                         │    ┌───────────────────────────────────────────────────┐
               │                         │    │                 MEMBER SIDE                       │
               │                         │    │         (Opens App / Notification)               │
               │                         │    └──────────────────────┬────────────────────────────┘
               │                         │                           │
               │                         │                           ▼
               │                         │    ┌───────────────────────────────────────────────────┐
               │                         │    │           MEMBER VIEWS REQUEST                    │
               │                         │    │    POST /member/guestEntryRequests/detail         │
               │                         │    ├───────────────────────────────────────────────────┤
               │                         │    │  Shows: Name, Photo, Phone, Visitor Type,        │
               │                         │    │         Company (if any), Time of request        │
               │                         │    └──────────────────────┬────────────────────────────┘
               │                         │                           │
               │                         │              ┌────────────┴────────────┐
               │                         │              │    MEMBER DECISION      │
               │                         │              └────────────┬────────────┘
               │                         │                    │             │
               │                         │             APPROVE │             │ REJECT
               │                         │                    ▼             ▼
               │                         │    ┌─────────────────────┐ ┌─────────────────────┐
               │                         │    │ PATCH /member/      │ │ PATCH /member/      │
               │                         │    │ guestEntryRequests/ │ │ guestEntryRequests/ │
               │                         │    │ decision            │ │ decision            │
               │                         │    ├─────────────────────┤ ├─────────────────────┤
               │                         │    │ {                   │ │ {                   │
               │                         │    │  "requestId":"...", │ │  "requestId":"...", │
               │                         │    │  "decision":"approve"│ │  "decision":"reject"│
               │                         │    │ }                   │ │  "reason":"..."     │
               │                         │    │                     │ │ }                   │
               │                         │    │ → status="approved" │ │ → status="rejected" │
               │                         │    └─────────┬───────────┘ └─────────┬───────────┘
               │                         │              │                       │
               │                         │              │                       ▼
               │                         │              │         ┌─────────────────────────┐
               │                         │              │         │   VISITOR DENIED ENTRY  │
               │                         │              │         │   Guard informs visitor │
               │                         │              │         │        END FLOW         │
               │                         │              │         └─────────────────────────┘
               └─────────────────────────┼──────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                               GUARD SIDE                                            │
│                          (Request is now APPROVED)                                  │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         GUARD ALLOWS ENTRY                                          │
│              POST /guard/guestEntryRequests/allowEntry                              │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Request: { "requestId": "..." }                                                    │
│                                                                                     │
│  → status changes from "approved" to "entered"                                      │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           VISITOR IS INSIDE                                         │
│                          status = "entered"                                         │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         │  (Visitor leaving)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          GUARD MARKS EXIT                                           │
│              POST /guard/guestEntryRequests/allowExit                               │
│                                                                                     │
│  → status = "left"                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Alternative: Guard Allows Entry Without Approval

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    GUARD CAN BYPASS MEMBER APPROVAL                                 │
│            POST /guard/guestEntryRequests/allowEntryWithoutApproval                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  Use Case:                                                                          │
│  • Member is not responding to notification                                         │
│  • Visitor is clearly expected (known frequent visitor)                             │
│  • Emergency situation                                                              │
│                                                                                     │
│  Request: { "requestId": "..." }                                                    │
│                                                                                     │
│  What happens:                                                                      │
│  • status changes: "pending" → "approved" → "entered"                               │
│  • approvedByGuardWithoutMemberResponse = true                                      │
│  • Guard is recorded as the approver                                                │
│                                                                                     │
│  This is logged for audit purposes.                                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Photo Requirement Logic

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          PHOTO HANDLING                                             │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  When guard creates entry request, system checks:                                   │
│                                                                                     │
│  1. Does visitor have photo from previous visit?                                    │
│     • YES → Use existing photo, photoRequired = false                               │
│     • NO  → Continue to step 2                                                      │
│                                                                                     │
│  2. Did guard provide photo in request?                                             │
│     • YES → Use provided photo, photoRequired = false                               │
│     • NO  → Create DRAFT, photoRequired = true                                      │
│                                                                                     │
│  If photoRequired = true:                                                           │
│  • Guard must capture photo                                                         │
│  • Use PATCH /guard/guestEntryRequests/photo to update                              │
│  • Request stays as draft until photo added                                         │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Flow 3: Pre-Approved Delivery

### Member Pre-Approval Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              MEMBER SIDE                                            │
│                        (Expecting a delivery)                                       │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    CREATE DELIVERY PRE-APPROVAL                                     │
│                POST /member/deliveryPreApprovals/quick                              │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  Request Body:                                                                      │
│  {                                                                                  │
│    "companyId": "...",                 ← Required (Swiggy, Zomato, etc.)            │
│    "visitorName": "Optional Name",     ← Optional                                   │
│    "validityHours": 2,                 ← OR use validTillTime                       │
│    "validTillTime": "2024-01-15T18:00:00.000Z",                                     │
│    "isSilentDelivery": false           ← If true, no notification when arrives      │
│  }                                                                                  │
│                                                                                     │
│  Response:                                                                          │
│  {                                                                                  │
│    "preApprovalId": "...",                                                          │
│    "status": "active",                                                              │
│    "companyName": "Swiggy",                                                         │
│    "validFrom": "...",                                                              │
│    "validTill": "..."                                                               │
│  }                                                                                  │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         │  (Pre-approval is now active)
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         DELIVERY PERSON ARRIVES                                     │
│                           (At the gate)                                             │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      GUARD CREATES ENTRY REQUEST                                    │
│                     POST /guard/guestEntryRequests                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  {                                                                                  │
│    "name": "Delivery Person",                                                       │
│    "phoneNumber": "+91...",                                                         │
│    "visitorType": "delivery_executive",                                             │
│    "companyId": "...",                     ← Same company as pre-approval           │
│    "companyName": "Swiggy",                                                         │
│    "unitId": "...",                                                                 │
│    "imageUrl": "..."                                                                │
│  }                                                                                  │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      SYSTEM AUTO-MATCHING                                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  System checks for matching pre-approval:                                           │
│  ✓ Same unit?                                                                       │
│  ✓ Same delivery company?                                                           │
│  ✓ Within validity time window?                                                     │
│  ✓ Pre-approval not already used?                                                   │
│                                                                                     │
│  If all match:                                                                      │
│  → status = "approved" (AUTO-APPROVED!)                                             │
│  → No notification sent to member                                                   │
│  → Guard can immediately allow entry                                                │
│                                                                                     │
│  If no match:                                                                       │
│  → status = "pending"                                                               │
│  → Normal approval flow                                                             │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        GUARD ALLOWS ENTRY                                           │
│              POST /guard/guestEntryRequests/allowEntry                              │
│                                                                                     │
│  → status = "entered"                                                               │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
                    (Normal exit flow when delivery complete)
```

### Manage Delivery Pre-Approvals

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    DELIVERY PRE-APPROVAL MANAGEMENT                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  UPDATE:                                                                            │
│  PATCH /member/deliveryPreApprovals                                                 │
│  {                                                                                  │
│    "preApprovalId": "...",                                                          │
│    "validityHours": 4,                  ← Extend time                               │
│    "isSilentDelivery": true             ← Update settings                           │
│  }                                                                                  │
│                                                                                     │
│  CANCEL:                                                                            │
│  DELETE /member/deliveryPreApprovals                                                │
│  {                                                                                  │
│    "preApprovalId": "..."                                                           │
│  }                                                                                  │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Flow 4: Pre-Approved Taxi Driver

### Member Pre-Approval Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              MEMBER SIDE                                            │
│                         (Booked a cab)                                              │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    CREATE TAXI PRE-APPROVAL                                         │
│                POST /member/taxiDriverPreApprovals/quick                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  Request Body:                                                                      │
│  {                                                                                  │
│    "companyId": "...",                 ← Required (Uber, Ola, etc.)                 │
│    "visitorName": "Driver Name",       ← Optional                                   │
│    "vehicleNumber": "MH01AB1234",      ← Optional (for better matching)             │
│    "validityHours": 1,                                                              │
│    "isPrivateInvite": false            ← Hide from society logs                     │
│  }                                                                                  │
│                                                                                     │
│  Response:                                                                          │
│  {                                                                                  │
│    "preApprovalId": "...",                                                          │
│    "status": "active",                                                              │
│    "companyName": "Uber",                                                           │
│    "vehicleNumber": "MH01AB1234"                                                    │
│  }                                                                                  │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         │  (Pre-approval is now active)
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           TAXI ARRIVES AT GATE                                      │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      GUARD CREATES ENTRY REQUEST                                    │
│                     POST /guard/guestEntryRequests                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  {                                                                                  │
│    "name": "Driver Name",                                                           │
│    "phoneNumber": "+91...",                                                         │
│    "visitorType": "taxi_vehicle_driver",                                            │
│    "companyId": "...",                                                              │
│    "companyName": "Uber",                                                           │
│    "vehicleNumber": "MH01AB1234",      ← If matches pre-approval → auto-approve     │
│    "unitId": "...",                                                                 │
│    "imageUrl": "..."                                                                │
│  }                                                                                  │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      SYSTEM AUTO-MATCHING                                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  System checks for matching pre-approval:                                           │
│  ✓ Same unit?                                                                       │
│  ✓ Same taxi company?                                                               │
│  ✓ Vehicle number matches (if provided in pre-approval)?                            │
│  ✓ Within validity time window?                                                     │
│                                                                                     │
│  If match → AUTO-APPROVED!                                                          │
│  If no match → Normal approval flow                                                 │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
                    (Same entry/exit flow as delivery)
```

---

## Flow 5: Pre-Approved Other Visitor (Service Provider)

### Member Pre-Approval Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              MEMBER SIDE                                            │
│                    (Expecting plumber, electrician, etc.)                           │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                  CREATE OTHER VISITOR PRE-APPROVAL                                  │
│              POST /member/otherVisitorPreApprovals/quick                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  Request Body:                                                                      │
│  {                                                                                  │
│    "workCategory": "plumbing",          ← Required (see categories below)           │
│    "companyId": "...",                  ← Optional (Urban Company, etc.)            │
│    "visitorName": "Worker Name",        ← Optional                                  │
│    "validityHours": 4,                                                              │
│    "isPrivateInvite": false                                                         │
│  }                                                                                  │
│                                                                                     │
│  Work Categories:                                                                   │
│  • plumbing                                                                         │
│  • electrical                                                                       │
│  • carpentry                                                                        │
│  • painting                                                                         │
│  • cleaning                                                                         │
│  • pest_control                                                                     │
│  • appliance_repair                                                                 │
│  • ac_service                                                                       │
│  • internet_cable                                                                   │
│  • courier                                                                          │
│  • other                                                                            │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         │  (Pre-approval is now active)
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                       SERVICE PROVIDER ARRIVES                                      │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      GUARD CREATES ENTRY REQUEST                                    │
│                     POST /guard/guestEntryRequests                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  {                                                                                  │
│    "name": "Worker Name",                                                           │
│    "phoneNumber": "+91...",                                                         │
│    "visitorType": "other_visitor",                                                  │
│    "companyId": "...",                                                              │
│    "companyName": "Urban Company",                                                  │
│    "workCategory": "plumbing",         ← Must match pre-approval                    │
│    "unitId": "...",                                                                 │
│    "imageUrl": "..."                                                                │
│  }                                                                                  │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      SYSTEM AUTO-MATCHING                                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  System checks for matching pre-approval:                                           │
│  ✓ Same unit?                                                                       │
│  ✓ Same work category?                                                              │
│  ✓ Company matches (if specified in pre-approval)?                                  │
│  ✓ Within validity time window?                                                     │
│                                                                                     │
│  If match → AUTO-APPROVED!                                                          │
│  If no match → Normal approval flow                                                 │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
                    (Same entry/exit flow as delivery)
```

---

## Flow 6: Onboarded/Registered Visitor

### For Visitors with Their Own App/QR

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                       REGISTERED VISITOR                                            │
│                  (Has GatePal App / Visitor Account)                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  These are visitors who:                                                            │
│  • Have registered on GatePal as a visitor                                          │
│  • Have their own profile with photo                                                │
│  • Have a permanent QR code                                                         │
│  • Examples: Regular delivery agents, frequent service providers                    │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      VISITOR ARRIVES AT GATE                                        │
│                     (Shows their visitor QR)                                        │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      GUARD SCANS VISITOR QR                                         │
│                (QR type: 'gatepal_visitor')                                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  QR Payload contains:                                                               │
│  {                                                                                  │
│    "type": "gatepal_visitor",                                                       │
│    "userId": "...",                                                                 │
│    "visitorType": "delivery_executive",                                             │
│    "companyId": "...",                                                              │
│    "companyName": "Swiggy"                                                          │
│  }                                                                                  │
│                                                                                     │
│  Response returns visitor info for guard to create entry                            │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    CREATE VISITOR ENTRY                                             │
│                  POST /guard/visitorEntry                                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  {                                                                                  │
│    "visitorUserId": "...",             ← From QR scan                               │
│    "unitId": "...",                    ← Guard selects which flat                   │
│    "gateId": "..."                                                                  │
│  }                                                                                  │
│                                                                                     │
│  System:                                                                            │
│  • Uses visitor's profile data (name, phone, photo)                                 │
│  • Links entry to visitor's User account                                            │
│  • Checks for pre-approval (auto-approves if found)                                 │
│                                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
                    (Same approval/entry/exit flow as walk-in)
```

---

## Complete API Reference

### Member APIs - Guest Invites

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/member/guestInvites/quick` | Create quick/private invite |
| `POST` | `/member/guestInvites/frequent` | Create frequent invite |
| `POST` | `/member/guestInvites/group` | Create group invite |
| `PATCH` | `/member/guestInvites` | Update active invite |
| `DELETE` | `/member/guestInvites` | Cancel invite |
| `POST` | `/member/guestInvites/recentGuests` | Get recently invited guests |

### Member APIs - Pre-Approvals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/member/deliveryPreApprovals/quick` | Create delivery pre-approval |
| `PATCH` | `/member/deliveryPreApprovals` | Update delivery pre-approval |
| `DELETE` | `/member/deliveryPreApprovals` | Cancel delivery pre-approval |
| `POST` | `/member/taxiDriverPreApprovals/quick` | Create taxi pre-approval |
| `PATCH` | `/member/taxiDriverPreApprovals` | Update taxi pre-approval |
| `DELETE` | `/member/taxiDriverPreApprovals` | Cancel taxi pre-approval |
| `POST` | `/member/otherVisitorPreApprovals/quick` | Create other visitor pre-approval |
| `PATCH` | `/member/otherVisitorPreApprovals` | Update other visitor pre-approval |
| `DELETE` | `/member/otherVisitorPreApprovals` | Cancel other visitor pre-approval |

### Member APIs - Entry Requests

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/member/guestEntryRequests/list` | List all entry requests |
| `POST` | `/member/guestEntryRequests/detail` | Get request details |
| `PATCH` | `/member/guestEntryRequests/decision` | Approve/Reject request |
| `POST` | `/member/guestEntryRequests/allowExit` | Mark visitor exit |
| `POST` | `/member/guestEntryRequests/markWrongEntry` | Report wrong entry |
| `POST` | `/member/guestEntryRequests/adminLog` | Admin view all requests |

### Guard APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/guard/scanGuestInvite` | Scan guest invite QR |
| `POST` | `/guard/guestEntryRequests` | Create walk-in entry request |
| `POST` | `/guard/visitorEntry` | Create entry for registered visitor |
| `POST` | `/guard/entryDetails` | Add entry details after scan |
| `PATCH` | `/guard/entryDetails` | Update entry details |
| `POST` | `/guard/guestEntryRequests/list` | List entry requests |
| `GET` | `/guard/guestEntryRequests` | Get request detail(s) |
| `POST` | `/guard/guestEntryRequests/allowEntry` | Allow entry (after approval) |
| `POST` | `/guard/guestEntryRequests/allowEntryWithoutApproval` | Allow entry (bypass approval) |
| `POST` | `/guard/guestEntryRequests/allowExit` | Mark visitor exit |
| `PATCH` | `/guard/guestEntryRequests/photo` | Update visitor photo |
| `POST` | `/guard/guestEntryRequests/recentGuests` | Get recent guests for unit |

#### `/guard/entryDetails` Request Body (POST/PATCH)

```json
{
  "inviteId": "required-string",
  "guestId": "optional-string",
  "imageUrl": "optional-string-or-null",
  "guestName": "optional-string-or-null",
  "fullName": "optional-string-or-null",
  "phoneNumber": "optional-string-or-null",
  "countryCode": "optional-string (defaults to +91 when phoneNumber is sent)",
  "vehicleNumber": "optional-string-or-null",
  "accompanyingCount": "optional-non-negative-number"
}
```

#### `/guard/entryDetails` Response (key fields)

```json
{
  "data": {
    "requestId": "guest-entry-request-id",
    "inviteId": "invite-id",
    "inviteType": "quick|frequent|group",
    "arrivingGuest": { "guestId": "...", "name": "..." },
    "vehicleNumber": "...",
    "accompanyingCount": 0
  }
}
```

---

## Quick Reference: Decision Tree

```
                              ┌─────────────────────────────────────┐
                              │     VISITOR AT GATE                 │
                              └─────────────────┬───────────────────┘
                                                │
                              ┌─────────────────┴───────────────────┐
                              │         HAS QR CODE?                │
                              └─────────────────┬───────────────────┘
                                     │                    │
                                YES  │                    │  NO
                                     ▼                    ▼
           ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
           │       WHAT TYPE OF QR?          │  │    CREATE ENTRY REQUEST         │
           └─────────────┬───────────────────┘  │    POST /guard/guestEntryRequests │
                         │                      └─────────────────┬───────────────┘
        ┌────────────────┼────────────────┐                       │
        │                │                │                       ▼
        ▼                ▼                ▼     ┌─────────────────────────────────┐
┌───────────────┐ ┌───────────────┐ ┌───────────┐│   HAS MATCHING PRE-APPROVAL?   │
│ Guest Invite  │ │ Visitor QR    │ │ Member QR ││                                 │
│ (gatepal_     │ │ (gatepal_     │ │ (gatepal_ │└─────────────────┬───────────────┘
│  guest_invite)│ │  visitor)     │ │  member)  │         │                    │
└───────┬───────┘ └───────┬───────┘ └─────┬─────┘    YES  │                    │  NO
        │                 │               │               ▼                    ▼
        ▼                 ▼               ▼     ┌─────────────────┐ ┌─────────────────┐
┌───────────────┐ ┌───────────────┐ ┌───────────┐│ AUTO-APPROVED! │ │ PENDING         │
│ POST /guard/  │ │ POST /guard/  │ │ Member    ││ Allow Entry    │ │ Wait for member │
│ scanGuestInvite│ │ visitorEntry │ │ Entry     │└─────────────────┘ └─────────────────┘
│               │ │               │ │ Flow      │
│ → ENTERED     │ │ → Pending/    │ │           │
│   (auto)      │ │   Approved    │ │           │
└───────────────┘ └───────────────┘ └───────────┘
```

---

## Status Flow Diagram

```
                                    ┌─────────────┐
                                    │   START     │
                                    └──────┬──────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
            ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
            │   PENDING     │      │   APPROVED    │      │   ENTERED     │
            │               │      │ (auto from    │      │ (QR scan      │
            │ (walk-in)     │      │  pre-approval)│      │  auto-entry)  │
            └───────┬───────┘      └───────┬───────┘      └───────┬───────┘
                    │                      │                      │
         ┌──────────┼──────────┐           │                      │
         │          │          │           │                      │
         ▼          ▼          ▼           │                      │
┌─────────────┐ ┌─────────┐ ┌─────────┐    │                      │
│  REJECTED   │ │ EXPIRED │ │APPROVED │    │                      │
│             │ │(30 min) │ │         │    │                      │
│  (member)   │ │         │ │(member) │    │                      │
└─────────────┘ └─────────┘ └────┬────┘    │                      │
                                 │         │                      │
                                 └────┬────┘                      │
                                      │                           │
                                      ▼                           │
                              ┌───────────────┐                   │
                              │   ENTERED     │←──────────────────┘
                              │               │
                              │(guard allows) │
                              └───────┬───────┘
                                      │
                         ┌────────────┼────────────┐
                         │            │            │
                         ▼            ▼            ▼
                 ┌───────────┐ ┌───────────┐ ┌───────────┐
                 │   LEFT    │ │  WRONG    │ │CANCELLED  │
                 │           │ │  ENTRY    │ │           │
                 │ (exited)  │ │           │ │           │
                 └───────────┘ └───────────┘ └───────────┘
```

---

## Testing Checklist

### Guest Invite Flow (WITH QR)
- [ ] Create quick invite → Share QR → Scan at gate → Verify auto-entry
- [ ] Create private invite → Verify hidden from logs
- [ ] Create frequent invite → Verify re-entry works
- [ ] Create group invite → Verify maxEntries limit
- [ ] Scan expired invite → Verify rejection
- [ ] Scan already-used quick invite → Verify rejection

### Walk-in Flow (WITHOUT QR)
- [ ] Create entry request → Wait for approval → Allow entry
- [ ] Create entry request → Reject → Verify visitor denied
- [ ] Create entry request → Let expire (30 min) → Verify expired status
- [ ] Guard allows entry without approval → Verify flag set
- [ ] Photo required flow → Add photo → Complete entry

### Pre-Approval Flows
- [ ] Create delivery pre-approval → Matching delivery arrives → Verify auto-approve
- [ ] Create taxi pre-approval with vehicle → Matching taxi → Verify auto-approve
- [ ] Create other visitor pre-approval → Matching worker → Verify auto-approve
- [ ] Non-matching visitor → Verify normal approval flow

### Exit Flow
- [ ] Mark exit by guard → Verify status = "left"
- [ ] Mark exit by member → Verify status = "left"
- [ ] Mark wrong entry → Verify flag set

---

*Documentation generated for GatePal Server*
*Last updated: February 2026*

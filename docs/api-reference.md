# Gatepal API Reference 


### User App Auth & Onboarding (`/api/user-auth`)
| POST | `/api/user-auth/register` | Start onboarding for `member`, `guard`, or `visitor` role |
| POST | `/api/user-auth/register/verify-otp` | Verify OTP to continue onboarding | None |
| POST | `/api/user-auth/onboarding` | Submit onboarding payload (flow-specific) | Bearer token (user) |
| POST | `/api/user-auth/login` | Phone/password login for app users and society admins | None |
| POST | `/api/user-auth/forgot-password` | Request OTP for password reset | None |
| POST | `/api/user-auth/verify-otp` | Verify OTP to receive reset token | None |
| POST | `/api/user-auth/reset-password` | Reset password with reset token | None |

### Society Management (`/api/society`)
| GET | `/api/society/locations/country-cities` | Public reference data for countries/cities | None |
| GET | `/api/society/locations/registration-hierarchy` | Nested countries → cities → societies → wings/units | None |



## Onboarding Flow Summary
1. **Register** via `/api/user-auth/register`
   - Required: `role`, `countryCode`, `phoneNumber`, `password`, `confirmPassword`, `termsAccepted`.
   - Receives `userId`, `role`, and OTP (non-production).
2. **Verify OTP** via `/api/user-auth/register/verify-otp`
   - Input: `userId`, `otp`.
   - Response includes JWT `token` for onboarding continuation.
3. **Complete Onboarding** via `/api/user-auth/onboarding`
   - Authorization: `Bearer <token>` from previous step.
   - Body schema depends on onboarding flow resolved from `role` (member/guard/visitor as defined below).
   - Success response includes refreshed token and final user snapshot.

> **Note:** Users targeting `society_admin` role register as members first. During member onboarding, they auto-upgrade if their phone matches a pre-seeded society admin contact.

## Member Onboarding Payload

All fields are required unless stated otherwise.

| Field | Type | Notes |
| --- | --- | --- |
| `fullName` | string | Trimmed; used to update user profile |
| `email` | string | Trimmed + lowercased |
| `country` | string | Residence country |
| `city` | string | Residence city |
| `societyName` | string | Must match an existing society |
| `societyPin` | string | 6-digit string generated for each society |
| `wingName` | string | Wing identifier within society |
| `unitNumber` | string | Unit identifier |
| `occupantType` | enum | One of: `unit_owner`, `unit_owner_family_member`, `tenant`, `tenant_family_member` |
| `occupancyStatus` | enum | One of: `currently_residing`, `unit_rented`, `unit_vacant` |

Example:

```json
{
  "fullName": "Aditi Rao",
  "email": "aditi@example.com",
  "country": "India",
  "city": "Mumbai",
  "societyName": "Opal Residency",
  "societyPin": "482913",
  "wingName": "A",
  "unitNumber": "1203",
  "occupantType": "tenant",
  "occupancyStatus": "currently_residing"
}
```

## Guard Onboarding Payload

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `fullName` | string | Yes | Trimmed |
| `email` | string | No | Defaults to stored email |
| `societyId` | MongoId | No | If provided, must exist |
| `assignedGate` | string | No | e.g. `"North Gate"` |
| `shiftStart` | string (time) | No | Free-form; e.g. `"08:00"` |
| `shiftEnd` | string (time) | No | Free-form |
| `notes` | string | No | Additional instructions |

Example:

```json
{
  "fullName": "Raghav Singh",
  "email": "raghav.singh@example.com",
  "societyId": "665fe1d4d6a52b6a541ae2e8",
  "assignedGate": "Gate 2",
  "shiftStart": "08:00",
  "shiftEnd": "20:00",
  "notes": "Night shift backup"
}
```

## Visitor Onboarding Payloads

### Shared Requirements
- `visitorType` (enum) is mandatory and must be one of:
  - `guest`
  - `delivery_executive`
  - `taxi_vehicle_driver`
  - `other_visitor`
- `fullName` is required.
- `profilePhoto` and `qrCodeImage` must be Base64 data URLs (`data:image/{png|jpg|jpeg|webp};base64,...`). Photo must decode to ≥1 KB, QR ≥512 B.
- `companyName`, `vehicleNumber`, and `workCategory` requirements depend on the visitor type.
- Vehicle numbers must match `/^[A-Z0-9]{4,15}$/` (uppercase, no spaces/symbols).
- `workCategory` for `other_visitor` must be 3–60 characters.

### Guest Payload
```json
{
  "visitorType": "guest",
  "fullName": "Priya Nair",
  "profilePhoto": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...",
  "qrCodeImage": "data:image/png;base64,AAABAAEAEBAAAAAAIABoBAAAFgAAACgAAAAgAAAAQAAAAAEA...",
}
```

### Delivery Executive Payload
```json
{
  "visitorType": "delivery_executive",
  "fullName": "Zeeshan Khan",
  "profilePhoto": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/...",
  "qrCodeImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "companyName": "QuickCart",
  "vehicleNumber": "MH12AB1234"
}
```

### Taxi / Vehicle Driver Payload
```json
{
  "visitorType": "taxi_vehicle_driver",
  "fullName": "Maya Patel",
  "profilePhoto": "data:image/webp;base64,UklGRlIAAABXRUJQVlA4IC4AAAAQAgCdASoCAAIALGAcA...",
  "qrCodeImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "companyName": "CityCab",
  "vehicleNumber": "GJ01TX9087"
}
```

### Other Visitor Payload
```json
{
  "visitorType": "other_visitor",
  "fullName": "Ritika Das",
  "profilePhoto": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "qrCodeImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "companyName": "BrightFix Services",
  "vehicleNumber": "DL5CD2290",
  "workCategory": "Carpentry"
}
```

On success, the backend stores per-type metadata under `user.onboardingData.visitor` (e.g. `deliveryExecutive`, `taxiVehicleDriver`, `otherVisitor`).




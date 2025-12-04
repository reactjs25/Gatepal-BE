🟢 DAILY HELP MODULE — FINAL FUNCTIONAL REQUIREMENT DOC
1️⃣ Add Daily Help

Both Member and Society Admin can add daily help.

Added By	        Initial Status
Member	            Pending
Society Admin	    Approved

Only first time when a Daily Help is added to society (e.g., Maid, Cook, Driver) it requires approval.

2️⃣ Approval / Rejection Rules
Action	    Who Can Perform	Notes
Approve	    Society Admin only	Verification (police proof etc.) happens outside app
Reject	    Society Admin only	Reject reason is mandatory 

Once a Daily Help is approved, they become a Verified Society Daily Help.

3️⃣ Reuse of Approved Daily Help in Other Units

After a Daily Help has been approved in the society:
Any other member from the same society can add that Daily Help to their own unit without approval.
No verification needed again.
Status will directly be Approved.

4️⃣ Edit Details
Role	Permission
Member	Can edit only Daily Help assigned to their unit
Society Admin	Can edit any Daily Help in the society
5️⃣ Removal / Deletion Behaviour
Removed By	What Happens
Member	Removes Daily Help only from their unit (not entire society)
Society Admin	Removes Daily Help from entire society (global removal)
6️⃣ Status Lifecycle
Member Added → Pending → Approved / Rejected by Admin
Admin Added → Approved directly
Approved → Reusable by other units
Rejected → Can be added again in future (new approval needed)
Removed by Member → Removed from their unit only
Removed by Admin → Fully removed from society

7️⃣ Tab Behaviour (UI → API mapping)
Tab Name	API Filter
Pending	status = "PENDING"
Approved	status = "APPROVED"
Rejected	status = "REJECTED"
Removed	status = "REMOVED"
8️⃣ Important Notes for Development

Reject API must enforce mandatory reason.

Once approved, Daily Help record becomes global and reusable within society.
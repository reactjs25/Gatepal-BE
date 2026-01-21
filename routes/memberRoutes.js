const express = require('express');
const {
  addMemberUnit,
  updateUnitOccupancyStatus,
  getUnitById,
  getUnitDashboard,
} = require('../controller/member/unitController');
const {
  getMemberProfile,
  updateMemberProfile,
} = require('../controller/member/profileController');
const {
  addFamilyMember,
  getFamilyMembersByUnit,
  updateFamilyMember,
  deleteFamilyMember,
  getFamilyMemberById,
} = require('../controller/member/familyController');
const {
  createQuickInvite,
  createGroupInvite,
  createFrequentInvite,
  getRecentGuests,
} = require('../controller/guestInviteController');
const {
  listGuestEntryRequestsForMember,
  decideGuestEntryRequest,
} = require('../controller/guestEntryRequestController');
const { createDeliveryPreApproval } = require('../controller/deliveryPreApprovalController');
const { createTaxiDriverPreApproval } = require('../controller/taxiDriverPreApprovalController');
const { createOtherVisitorPreApproval } = require('../controller/otherVisitorPreApprovalController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.post('/units', userAuthMiddleware, addMemberUnit);
router.patch('/units/:id', userAuthMiddleware, updateUnitOccupancyStatus);
router.get('/profile', userAuthMiddleware, getMemberProfile);
router.get('/units/:id', userAuthMiddleware, getUnitById);
router.get('/dashboard', userAuthMiddleware, getUnitDashboard);
router.patch('/profile', userAuthMiddleware, updateMemberProfile);
router.post('/addFamily/:id', userAuthMiddleware, addFamilyMember);
router.get('/getFamily/:id', userAuthMiddleware, getFamilyMembersByUnit);
router.get('/getFamilyMember/:memberId', userAuthMiddleware, getFamilyMemberById);
router.patch('/updateFamily/:memberId', userAuthMiddleware, updateFamilyMember);
router.delete('/deleteFamily/:memberId', userAuthMiddleware, deleteFamilyMember);
router.post('/guestInvites/quick', userAuthMiddleware, createQuickInvite);
router.post('/guestInvites/group', userAuthMiddleware, createGroupInvite);
router.post('/guestInvites/frequent', userAuthMiddleware, createFrequentInvite);
router.post('/guestInvites/recentGuests', userAuthMiddleware, getRecentGuests);
router.post('/guestEntryRequests/list', userAuthMiddleware, listGuestEntryRequestsForMember);
router.patch('/guestEntryRequests/decision', userAuthMiddleware, decideGuestEntryRequest);
router.post('/deliveryPreApprovals/quick', userAuthMiddleware, createDeliveryPreApproval);
router.post('/taxiDriverPreApprovals/quick', userAuthMiddleware, createTaxiDriverPreApproval);
router.post('/otherVisitorPreApprovals/quick', userAuthMiddleware, createOtherVisitorPreApproval);


module.exports = router;

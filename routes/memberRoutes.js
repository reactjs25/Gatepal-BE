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
  updateGuestInviteForMember,
  cancelGuestInviteForMember,
} = require('../controller/guestInviteController');
const {
  listGuestEntryRequestsForMember,
  getGuestEntryRequestDetailForMember,
  decideGuestEntryRequest,
  allowGuestExitForMember,
} = require('../controller/guestEntryRequestController');
const {
  createDeliveryPreApproval,
  updateDeliveryPreApproval,
  cancelDeliveryPreApproval,
} = require('../controller/deliveryPreApprovalController');
const {
  createTaxiDriverPreApproval,
  updateTaxiDriverPreApproval,
  cancelTaxiDriverPreApproval,
} = require('../controller/taxiDriverPreApprovalController');
const {
  createOtherVisitorPreApproval,
  updateOtherVisitorPreApproval,
  cancelOtherVisitorPreApproval,
} = require('../controller/otherVisitorPreApprovalController');
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
router.patch('/guestInvites', userAuthMiddleware, updateGuestInviteForMember);
router.delete('/guestInvites', userAuthMiddleware, cancelGuestInviteForMember);
router.post('/guestEntryRequests/list', userAuthMiddleware, listGuestEntryRequestsForMember);
router.post('/guestEntryRequests/detail', userAuthMiddleware, getGuestEntryRequestDetailForMember);
router.patch('/guestEntryRequests/decision', userAuthMiddleware, decideGuestEntryRequest);
router.post('/guestEntryRequests/allowExit', userAuthMiddleware, allowGuestExitForMember);
router.post('/deliveryPreApprovals/quick', userAuthMiddleware, createDeliveryPreApproval);
router.patch('/deliveryPreApprovals', userAuthMiddleware, updateDeliveryPreApproval);
router.delete('/deliveryPreApprovals', userAuthMiddleware, cancelDeliveryPreApproval);
router.post('/taxiDriverPreApprovals/quick', userAuthMiddleware, createTaxiDriverPreApproval);
router.patch('/taxiDriverPreApprovals', userAuthMiddleware, updateTaxiDriverPreApproval);
router.delete('/taxiDriverPreApprovals', userAuthMiddleware, cancelTaxiDriverPreApproval);
router.post('/otherVisitorPreApprovals/quick', userAuthMiddleware, createOtherVisitorPreApproval);
router.patch('/otherVisitorPreApprovals', userAuthMiddleware, updateOtherVisitorPreApproval);
router.delete('/otherVisitorPreApprovals', userAuthMiddleware, cancelOtherVisitorPreApproval);


module.exports = router;

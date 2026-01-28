const express = require('express');
const {
  getAllSociety,
  updateGuardProfile,
  addSociety,
  getGuardProfile,
  startDuty,
  endDuty,
} = require('../controller/guard/guardController');
const { scanGuestInvite, updateGuestInviteEntryDetails } = require('../controller/guestInviteController');
const {
  getRecentGuestsForGuard,
  listGuestEntryRequestsForGuard,
  createGuestEntryRequest,
  createOnboardedVisitorEntry,
  getGuestEntryRequestForGuard,
  allowGuestEntry,
  allowEntryWithoutApproval,
  allowGuestExit,
  updateGuestEntryRequestPhoto,
} = require('../controller/guestEntryRequestController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/getAllSocieties', userAuthMiddleware, getAllSociety);
router.get('/getProfile', userAuthMiddleware, getGuardProfile);
router.put('/updateProfile', userAuthMiddleware, updateGuardProfile);
router.post('/addSociety', userAuthMiddleware, addSociety);
router.post('/startDuty', userAuthMiddleware, startDuty);
router.post('/endDuty', userAuthMiddleware, endDuty);
router.post('/scanGuestInvite', userAuthMiddleware, scanGuestInvite);
router.post('/entryDetails', userAuthMiddleware, updateGuestInviteEntryDetails);
router.patch('/entryDetails', userAuthMiddleware, updateGuestInviteEntryDetails);
router.post('/guestEntryRequests/recentGuests', userAuthMiddleware, getRecentGuestsForGuard);
router.post('/guestEntryRequests/list', userAuthMiddleware, listGuestEntryRequestsForGuard);
router.post('/guestEntryRequests', userAuthMiddleware, createGuestEntryRequest);
router.post('/visitorEntry', userAuthMiddleware, createOnboardedVisitorEntry);
router.get('/guestEntryRequests', userAuthMiddleware, getGuestEntryRequestForGuard);
router.post('/guestEntryRequests/allowEntry', userAuthMiddleware, allowGuestEntry);
router.post('/guestEntryRequests/allowEntryWithoutApproval', userAuthMiddleware, allowEntryWithoutApproval);
router.post('/guestEntryRequests/allowExit', userAuthMiddleware, allowGuestExit);
router.patch('/guestEntryRequests/photo', userAuthMiddleware, updateGuestEntryRequestPhoto);


module.exports = router;

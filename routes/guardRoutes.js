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
  createGuestEntryRequest,
  getGuestEntryRequestForGuard,
  allowGuestEntry,
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
router.patch('/entryDetails', userAuthMiddleware, updateGuestInviteEntryDetails);
router.post('/guestEntryRequests/recentGuests', userAuthMiddleware, getRecentGuestsForGuard);
router.post('/guestEntryRequests', userAuthMiddleware, createGuestEntryRequest);
router.get('/guestEntryRequests/:requestId', userAuthMiddleware, getGuestEntryRequestForGuard);
router.post('/guestEntryRequests/:requestId/allowEntry', userAuthMiddleware, allowGuestEntry);

module.exports = router;

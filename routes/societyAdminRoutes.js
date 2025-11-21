const express = require('express');
const {
  createSocietyAdmin,
  getAllSocietyAdmins,
  getSocietyAdminById,
  updateSocietyAdmin,
  toggleSocietyAdminStatus,
  deleteSocietyAdmin,
  requestSocietyAdminPasswordReset,
} = require('../controller/societyAdminController');
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/:societyId', authMiddleware, createSocietyAdmin);
router.get('/:societyId', authMiddleware, getAllSocietyAdmins);
router.get('/:societyId/:adminId', authMiddleware, getSocietyAdminById);
router.put('/:societyId/:adminId', authMiddleware, updateSocietyAdmin);
router.patch(
  '/:societyId/:adminId/toggle-status',
  authMiddleware,
  toggleSocietyAdminStatus
);
router.delete('/:societyId/:adminId', authMiddleware, deleteSocietyAdmin);
router.post(
  '/:societyId/:adminId/send-reset-link',
  authMiddleware,
  requestSocietyAdminPasswordReset
);

module.exports = router;
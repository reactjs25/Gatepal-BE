const express = require('express');
const {
  createSocietyRule,
  getSocietyRules,
  updateSocietyRuleById,
  deleteSocietyRuleById,
  getSocietyRuleCategories,
  getSocietyRuleCategoriesForMember,
} = require('../controller/society/societyRulesController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/categories', userAuthMiddleware, getSocietyRuleCategories);
router.get('/member/categories', userAuthMiddleware, getSocietyRuleCategoriesForMember);
router.post('/', userAuthMiddleware, createSocietyRule);
router.get('/', userAuthMiddleware, getSocietyRules);
router.patch('/', userAuthMiddleware, updateSocietyRuleById);
router.delete('/', userAuthMiddleware, deleteSocietyRuleById);

module.exports = router;

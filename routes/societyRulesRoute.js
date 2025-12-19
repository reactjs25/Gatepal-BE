const express = require('express');
const {
  createSocietyRule,
  getSocietyRules,
  getSocietyRuleById,
  updateSocietyRuleById,
  deleteSocietyRuleById,
  getSocietyRuleCategories,
} = require('../controller/society/societyRulesController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/categories', userAuthMiddleware, getSocietyRuleCategories);
router.post('/', userAuthMiddleware, createSocietyRule);
router.get('/', userAuthMiddleware, getSocietyRules);
router.get('/single', userAuthMiddleware, getSocietyRuleById);
router.patch('/', userAuthMiddleware, updateSocietyRuleById);
router.delete('/', userAuthMiddleware, deleteSocietyRuleById);

module.exports = router;


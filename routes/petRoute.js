const express = require('express');
const { addPet, getPetsByUnit, editPet, deletePet, getPetById } = require('../controller/member/petController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.post('/:unitId', userAuthMiddleware, addPet);
router.get('/:unitId', userAuthMiddleware, getPetsByUnit);
router.get('/:unitId/:petId', userAuthMiddleware, getPetById);
router.patch('/:unitId/:petId', userAuthMiddleware, editPet);
router.delete('/:unitId/:petId', userAuthMiddleware, deletePet);


module.exports = router;

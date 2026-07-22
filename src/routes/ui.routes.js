const express = require('express');
const router = express.Router();
const uiController = require('../controllers/ui.controller');

router.get('/navegacion', uiController.getNavegacion);

module.exports = router;

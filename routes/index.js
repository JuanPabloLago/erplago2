const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');
router.use('/usuarios', authRoutes);
module.exports = router;

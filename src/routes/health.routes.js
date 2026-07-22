'use strict';
/**
 * HEALTH ENDPOINT — heartbeat para connection-indicator
 *
 * SIN auth, SIN DB, SIN logging.
 * Responde un objeto trivial. Sirve solo para que el frontend
 * sepa si el backend esta vivo y la red esta OK.
 *
 * Si en el futuro queremos un health-check "real" que verifique
 * la BD, agregamos /api/health/deep que SI consulta.
 */
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

module.exports = router;

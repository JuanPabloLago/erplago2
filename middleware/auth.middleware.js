const jwt = require('jsonwebtoken');

const verificarToken = (req, res, next) => {
    const bearerHeader = req.headers['authorization'];
    if (typeof bearerHeader !== 'undefined') {
        const bearer = bearerHeader.split(' ');
        if (bearer.length !== 2 || bearer[0] !== 'Bearer') {
            return res.status(401).json({ error: 'Formato de token inválido' });
        }
        const bearerToken = bearer[1];
        jwt.verify(bearerToken, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                console.error('⚠️ Token inválido:', err.message);
                return res.status(403).json({ error: 'Token inválido o expirado' });
            }
            req.usuario = decoded;
            next();
        });
    } else {
        res.status(401).json({ error: 'Token no proporcionado' });
    }
};

const verificarAdmin = (req, res, next) => {
    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
    }
    next();
};

module.exports = { verificarToken, verificarAdmin };

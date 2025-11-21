const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    try {
        const { rows } = await pool.query(
            'SELECT * FROM usuarios WHERE username = $1 AND estado = $2',
            [username, 'activo']
        );
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        const usuario = rows[0];
        const passwordValida = await bcrypt.compare(password, usuario.password_hash);
        if (!passwordValida) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        const payload = {
            id_usuario: usuario.id_usuario,
            id_empresa: usuario.id_empresa,
            rol: usuario.rol
        };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({
            message: 'Login exitoso',
            token,
            usuario: {
                username: usuario.username,
                rol: usuario.rol,
                id_empresa: usuario.id_empresa
            }
        });
    } catch (error) {
        console.error('❌ Error en login:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

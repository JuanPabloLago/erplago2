// Verificar si el token está por expirar y renovarlo automáticamente
function verificarYRenovarToken() {
    const authToken = localStorage.getItem('authToken');
    
    if (!authToken) {
        console.warn('No hay token');
        return;
    }
    
    try {
        const payload = JSON.parse(atob(authToken.split('.')[1]));
        const exp = payload.exp * 1000; // Convertir a milisegundos
        const now = Date.now();
        const tiempoRestante = exp - now;
        
        // Si expira en menos de 30 minutos, redirigir a login
        if (tiempoRestante < 30 * 60 * 1000) {
            console.warn('Token por expirar, redirigiendo a login...');
            localStorage.clear();
            window.location.href = '/login.html';
        }
    } catch (e) {
        console.error('Error verificando token:', e);
    }
}

// Ejecutar cada minuto
setInterval(verificarYRenovarToken, 60000);

// Verificar al cargar la página
verificarYRenovarToken();

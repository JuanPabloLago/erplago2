function verificarAutenticacion() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    
    console.log('Verificando autenticación...', {token: token ? 'existe' : 'NO existe', username});
    
    if (!token) {
        console.log('No hay token, redirigiendo a login');
        window.location.href = '/login.html';
        return false;
    }
    
    const userInfo = document.getElementById('userInfo');
    if (userInfo && username) {
        userInfo.textContent = username;
    }
    
    console.log('Autenticación OK');
    return true;
}

function logout() {
    console.log('Cerrando sesión...');
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.href = '/login.html';
}

console.log('auth.js cargado correctamente');

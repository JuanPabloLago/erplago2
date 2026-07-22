// =======================================================================
//                    INDICADOR DE CONEXIÓN GLOBAL
// =======================================================================

(function() {
    'use strict';

    // =======================================================================
    //                    CONFIGURACIÓN
    // =======================================================================

    const CONFIG = {
        CHECK_INTERVAL: 60000,      // Verificar cada 60 segundos
        RETRY_INTERVAL: 15000,       // Reintentar cada 15 segundos si falla
        REQUEST_TIMEOUT: 15000,      // Timeout de 15 segundos para requests
        API_URL: window.location.hostname === 'localhost'
            ? 'http://localhost:3000'
            : window.location.protocol + '//' + window.location.hostname + ':3000'
    };

    // =======================================================================
    //                    ESTADO GLOBAL
    // =======================================================================

    let isOnline = true;
    let checkInterval = null;
    let retryTimeout = null;
    let consecutiveFailures = 0;

    // =======================================================================
    //                    CREACIÓN DEL INDICADOR VISUAL
    // =======================================================================

    function createIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'connection-indicator';
        indicator.setAttribute('role', 'status');
        indicator.setAttribute('aria-live', 'polite');

        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 8px 15px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            z-index: 9999;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
            cursor: pointer;
            user-select: none;
        `;

        indicator.addEventListener('click', () => {
            console.log('🔄 Verificación manual de conexión...');
            checkConnection();
        });

        indicator.title = 'Click para verificar conexión';

        document.body.appendChild(indicator);
        return indicator;
    }

    const indicator = createIndicator();

    // =======================================================================
    //                    ESTADOS VISUALES
    // =======================================================================

    function setOnline() {
        indicator.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
        indicator.style.color = 'white';
        indicator.innerHTML = `
            <span style="width: 8px; height: 8px; background: white; border-radius: 50%; display: inline-block;"></span>
            <span>En línea</span>
        `;
        indicator.setAttribute('aria-label', 'Conexión activa');
        indicator.title = 'Click para verificar conexión';
    }

    function setOffline() {
        indicator.style.background = 'linear-gradient(135deg, #eb3349 0%, #f45c43 100%)';
        indicator.style.color = 'white';
        indicator.innerHTML = `
            <span style="width: 8px; height: 8px; background: white; border-radius: 50%; display: inline-block; animation: blink 1s infinite;"></span>
            <span>Sin conexión</span>
        `;
        indicator.setAttribute('aria-label', 'Sin conexión al servidor');
        indicator.title = 'Sin conexión - Click para reintentar';
    }

    function setReconnecting() {
        indicator.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
        indicator.style.color = 'white';
        indicator.innerHTML = `
            <span style="width: 8px; height: 8px; background: white; border-radius: 50%; display: inline-block; animation: pulse 1s infinite;"></span>
            <span>Reconectando...</span>
        `;
        indicator.setAttribute('aria-label', 'Intentando reconectar');
        indicator.title = 'Reconectando...';
    }

    function setTokenExpired() {
        indicator.style.background = 'linear-gradient(135deg, #fc4a1a 0%, #f7b733 100%)';
        indicator.style.color = 'white';
        indicator.innerHTML = `
            <span style="width: 8px; height: 8px; background: white; border-radius: 50%; display: inline-block;"></span>
            <span>Sesión expirada</span>
        `;
        indicator.setAttribute('aria-label', 'Sesión expirada');
        indicator.title = 'Tu sesión ha expirado - Click para ir a login';
        
        // Permitir ir a login haciendo click
        indicator.style.cursor = 'pointer';
        indicator.onclick = () => {
            console.warn('Token expirado - server-side redirigira');
        };
    }

    // =======================================================================
    //                    ESTILOS CSS PARA ANIMACIONES
    // =======================================================================

    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes blink {
                0%, 50% { opacity: 1; }
                51%, 100% { opacity: 0.3; }
            }

            @keyframes pulse {
                0%, 100% {
                    transform: scale(1);
                    opacity: 1;
                }
                50% {
                    transform: scale(1.3);
                    opacity: 0.7;
                }
            }

            #connection-indicator:hover {
                transform: scale(1.05);
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            }

            #connection-indicator:active {
                transform: scale(0.98);
            }
        `;
        document.head.appendChild(style);
    }

    addStyles();

    // =======================================================================
    //                    VERIFICACIÓN DE CONEXIÓN
    // =======================================================================

    async function checkConnection() {
        const token = localStorage.getItem('authToken');

        // Si no hay token y estamos en login.html, no verificar
        if (!token && window.location.pathname.includes('login.html')) {
            console.log('📝 En página de login sin token - no verificar conexión');
            indicator.style.display = 'none'; // Ocultar indicador en login
            return;
        }

        // Si no hay token en otras páginas, mostrar sesión expirada
        if (!token) {
            console.warn('⚠️ No hay token de autenticación');
            setTokenExpired();
            isOnline = false;
            return;
        }

        // Mostrar indicador si estaba oculto
        indicator.style.display = 'flex';

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

            const response = await fetch(`${CONFIG.API_URL}/api/health`, {
                signal: controller.signal,
                cache: 'no-store'
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                handleConnectionSuccess();
            } else if (response.status === 401 || response.status === 403) {
                handleTokenExpired();
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

        } catch (error) {
            handleConnectionFailure(error);
        }
    }

    function handleConnectionSuccess() {
        if (!isOnline) {
            console.log('✅ Conexión restaurada');
            window.dispatchEvent(new CustomEvent('connectionRestored'));
        }

        isOnline = true;
        consecutiveFailures = 0;
        setOnline();

        if (retryTimeout) {
            clearTimeout(retryTimeout);
            retryTimeout = null;
        }
    }

    function handleTokenExpired() {
        console.warn('⚠️ Token de autenticación expirado');
        setTokenExpired();
        isOnline = false;

        // NO mostrar alert, solo indicador visual
        console.log('🔒 Sesión expirada - Click en el indicador para ir a login');
        
        window.dispatchEvent(new CustomEvent('sessionExpired'));
    }

    function handleConnectionFailure(error) {
        consecutiveFailures++;

        if (isOnline) {
            console.warn(`⚠️ Conexión perdida (intento ${consecutiveFailures}):`, error.message);
            isOnline = false;
            setReconnecting();

            window.dispatchEvent(new CustomEvent('connectionLost'));

            if (!retryTimeout) {
                retryTimeout = setTimeout(checkConnection, CONFIG.RETRY_INTERVAL);
            }
        } else {
            if (consecutiveFailures > 3) {
                setOffline();
                console.error('❌ Múltiples intentos fallidos de reconexión');
            }
        }
    }

    // =======================================================================
    //                    INICIALIZACIÓN Y LIMPIEZA
    // =======================================================================

    function startConnectionMonitoring() {
        console.log('🔌 Iniciando monitoreo de conexión...');

        // Primera verificación inmediata
        checkConnection();

        // Verificación periódica
        checkInterval = setInterval(checkConnection, CONFIG.CHECK_INTERVAL);

        window.addEventListener('focus', () => {
            console.log('👁️ Ventana enfocada - verificando conexión');
            checkConnection();
        });

        window.addEventListener('online', () => {
            console.log('🌐 Navegador reporta estar online');
            checkConnection();
        });

        window.addEventListener('offline', () => {
            console.log('📡 Navegador reporta estar offline');
            setOffline();
            isOnline = false;
        });
    }

    function stopConnectionMonitoring() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
        if (retryTimeout) {
            clearTimeout(retryTimeout);
            retryTimeout = null;
        }
    }

    window.addEventListener('beforeunload', stopConnectionMonitoring);

    // =======================================================================
    //                    API PÚBLICA
    // =======================================================================

    window.connectionStatus = {
        isOnline: () => isOnline,
        check: checkConnection,
        getFailureCount: () => consecutiveFailures,
        start: startConnectionMonitoring,
        stop: stopConnectionMonitoring,
        getConfig: () => ({...CONFIG})
    };

    // =======================================================================
    //                    INICIO AUTOMÁTICO
    // =======================================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startConnectionMonitoring);
    } else {
        startConnectionMonitoring();
    }

    console.log('✅ Indicador de conexión inicializado');

})();

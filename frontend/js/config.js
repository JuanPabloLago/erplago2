// ═══════════════════════════════════════════════════════════════════════════
// Configuración global del frontend ERP LAGO
// Expone:
//   - window.CONFIG          → API_BASE_URL, TOKEN_KEY
//   - window.API             → helper centralizado con GET/POST/PUT/DELETE/PATCH
//                              · usa CONFIG.TOKEN_KEY desde localStorage
//                              · envía credentials: 'include' para cookies
//                              · mergea headers y body (objeto → JSON, string → raw)
//                              · tira excepción si !response.ok (status, data adjuntos)
// ═══════════════════════════════════════════════════════════════════════════

const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL  = isDevelopment
    ? 'http://localhost:3000/api'
    : window.location.protocol + '//' + window.location.hostname + ':3000/api';

window.CONFIG = {
    API_BASE_URL: API_BASE_URL,
    TOKEN_KEY:    'authToken'
};

class API {
    static async request(endpoint, options) {
        options = options || {};
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);

        const headers = Object.assign(
            { 'Content-Type': 'application/json' },
            options.headers || {}
        );
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const body = options.body;
        const bodyOut =
            body === undefined || body === null ? undefined
          : typeof body === 'string'             ? body
          : JSON.stringify(body);

        const response = await fetch(CONFIG.API_BASE_URL + endpoint, {
            method:      options.method || 'GET',
            credentials: 'include',
            headers:     headers,
            body:        bodyOut
        });

        if (response.status === 401) {
            console.debug('API 401 — seguridad delegada al middleware backend');
        }

        // Parseo tolerante: respuestas 204/sin body devuelven {}
        let data = {};
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
            data = await response.json().catch(function() { return {}; });
        }

        if (!response.ok) {
            const err = new Error(data.error || data.message || ('HTTP ' + response.status));
            err.status = response.status;
            err.data   = data;
            throw err;
        }

        return data;
    }

    static get(endpoint, options)         { return this.request(endpoint, Object.assign({}, options, { method: 'GET' })); }
    static post(endpoint, body, options)  { return this.request(endpoint, Object.assign({}, options, { method: 'POST',  body: body })); }
    static put(endpoint, body, options)   { return this.request(endpoint, Object.assign({}, options, { method: 'PUT',   body: body })); }
    static delete(endpoint, options)      { return this.request(endpoint, Object.assign({}, options, { method: 'DELETE' })); }
    static patch(endpoint, body, options) { return this.request(endpoint, Object.assign({}, options, { method: 'PATCH', body: body })); }
}

window.API = API;

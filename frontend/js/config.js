// Configuración centralizada
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const API_BASE_URL = isDevelopment 
    ? 'http://localhost:3000/api'
    : window.location.protocol + '//' + window.location.hostname + ':3000/api';

window.CONFIG = {
    API_BASE_URL: API_BASE_URL,
    TOKEN_KEY: 'authToken'
};

class API {
    static async request(endpoint, options) {
        options = options || {};
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        const headers = {'Content-Type': 'application/json'};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        
        const url = CONFIG.API_BASE_URL + endpoint;
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        
        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login.html';
        }
        return response.json();
    }
    
    static get(endpoint) { return this.request(endpoint, {method: 'GET'}); }
    static post(endpoint, data) { return this.request(endpoint, {method: 'POST', body: data}); }
}

window.API = API;

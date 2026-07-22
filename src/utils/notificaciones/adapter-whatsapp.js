/**
 * ADAPTER WHATSAPP — STUB
 *
 * Punto de extension para integrar bot WhatsApp (Cloud API de Meta, Baileys,
 * whatsapp-web.js, Twilio, etc).
 *
 * Hoy: NO envia nada. Devuelve suprimida=true con motivo claro para que
 * quede registrado en notificaciones_log.
 *
 * Para activar el dia que se enchufe el bot:
 *   1. Implementar la funcion enviar() llamando al provider elegido.
 *   2. Agregar credenciales al .env (segun provider).
 *   3. Agregar 'whatsapp' a la config notificaciones.canales.<evento> en BD.
 *   4. No requiere tocar notificaciones.helper.js (Open/Closed Principle).
 */
async function enviar(client, args) {
    return {
        enviada: false,
        suprimida: true,
        motivo: 'adapter_whatsapp_no_implementado_aun'
    };
}

module.exports = { enviar };

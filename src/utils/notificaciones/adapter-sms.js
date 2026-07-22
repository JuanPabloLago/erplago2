/**
 * ADAPTER SMS — STUB futuro (no prioritario)
 */
async function enviar(client, args) {
    return { enviada: false, suprimida: true, motivo: 'adapter_sms_no_implementado_aun' };
}
module.exports = { enviar };

const fetch = require('node-fetch');

exports.analizar = async (req, res) => {
    const { imagen_base64 } = req.body;
    if (!imagen_base64) return res.status(400).json({ error: 'Falta imagen' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en .env del servidor' });

    try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1500,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagen_base64 } },
                        { type: 'text', text: `Analiza esta factura de compra argentina. Devolvé SOLO JSON puro sin backticks:
{"proveedor":{"razon_social":"","cuit":"XX-XXXXXXXX-X","condicion_iva":1,"domicilio":"","localidad":"","provincia":""},
"comprobante":{"tipo_id":1,"punto_venta":"00001","numero":"00000001","fecha":"2026-01-01"},
"items":[{"descripcion":"","cantidad":0,"precio_unitario_neto":0,"iva_porcentaje":21,"subtotal_neto":0,"iva_monto":0}],
"totales":{"neto_gravado":0,"iva_21":0,"iva_105":0,"iva_27":0,"impuestos_internos":0,"otros_tributos":0,"total":0},
"pago":{"forma":"Efectivo","pagado":true},"observaciones":""}
tipo_id: 1=FC A, 2=FC B, 3=FC C, 4=NC, 5=ND. condicion_iva: 1=RI, 2=Mono, 4=Exento. CUIT con guiones formato XX-XXXXXXXX-X. precio_unitario_neto SIN IVA. Si hay ajuste por redondeo incorporalo al neto.` }
                    ]
                }]
            })
        });

        const data = await r.json();
        if (!r.ok) throw new Error(data.error?.message || 'Error API Anthropic: ' + r.status);

        const txt = data.content.map(c => c.text || '').join('');
        const parsed = JSON.parse(txt.replace(/```json|```/g, '').trim());
        res.json({ success: true, data: parsed });
    } catch (e) {
        console.error('factura-foto analizar:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// =======================================================================
//           ESTRATEGIA DE CONTINGENCIA PARA CAÍDA DE AFIP
// =======================================================================

class EstrategiaContingencia {
    
    static ESTADOS = {
        BORRADOR: 'borrador',
        PENDIENTE_CAE: 'pendiente_cae',
        AUTORIZADO: 'autorizado',
        ERROR_AFIP: 'error_afip',
        RECHAZADO: 'rechazado'
    };

    static async generarFacturaConContingencia(pool, facturaData, afipService) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const insertQuery = `
                INSERT INTO comprobantes_afip (
                    tipo_comprobante, punto_venta, numero, 
                    fecha, cliente_cuit, total, neto, iva,
                    estado, json_datos, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                RETURNING id_comprobante`;
            
            const resultado = await client.query(insertQuery, [
                facturaData.CbteTipo,
                facturaData.PtoVta,
                facturaData.CbteDesde,
                facturaData.CbteFch,
                facturaData.DocNro,
                facturaData.ImpTotal,
                facturaData.ImpNeto,
                facturaData.ImpIVA,
                this.ESTADOS.PENDIENTE_CAE,
                JSON.stringify(facturaData)
            ]);
            
            const idComprobante = resultado.rows[0].id_comprobante;
            console.log(`💾 Comprobante guardado en BD: ID ${idComprobante}`);
            
            try {
                console.log('📡 Solicitando CAE a AFIP...');
                const respuestaAfip = await afipService.generarFactura(facturaData);
                
                // IMPORTANTE: Verificar si es array o objeto único
                let detResponse;
                if (Array.isArray(respuestaAfip.FeDetResp.FECAEDetResponse)) {
                    detResponse = respuestaAfip.FeDetResp.FECAEDetResponse[0];
                } else {
                    detResponse = respuestaAfip.FeDetResp.FECAEDetResponse;
                }
                
                // AFIP devuelve Resultado: 'A' = Aprobado, 'R' = Rechazado
                if (detResponse.Resultado === 'A') {
                    const cae = detResponse.CAE;
                    const vencimiento = detResponse.CAEFchVto;
                    
                    // Capturar observaciones si existen (son warnings, no errores)
                    let observaciones = null;
                    if (detResponse.Observaciones && detResponse.Observaciones.Obs) {
                        observaciones = JSON.stringify(detResponse.Observaciones.Obs);
                    }
                    
                    await client.query(`
                        UPDATE comprobantes_afip 
                        SET estado = $1, cae = $2, cae_vencimiento = $3, 
                            respuesta_afip = $4, error_afip = $5, updated_at = NOW()
                        WHERE id_comprobante = $6`,
                        [this.ESTADOS.AUTORIZADO, cae, vencimiento, 
                         JSON.stringify(respuestaAfip), observaciones, idComprobante]
                    );
                    
                    await client.query('COMMIT');
                    
                    console.log(`✅ CAE obtenido: ${cae}`);
                    if (observaciones) {
                        console.log(`⚠️  Observaciones AFIP:`, observaciones);
                    }
                    
                    return {
                        success: true,
                        idComprobante,
                        cae,
                        vencimiento,
                        mensaje: 'Comprobante autorizado por AFIP',
                        observaciones: observaciones
                    };
                    
                } else {
                    // Resultado 'R' = Rechazado
                    const errores = detResponse.Observaciones;
                    
                    await client.query(`
                        UPDATE comprobantes_afip 
                        SET estado = $1, error_afip = $2, 
                            respuesta_afip = $3, updated_at = NOW()
                        WHERE id_comprobante = $4`,
                        [this.ESTADOS.RECHAZADO, JSON.stringify(errores),
                         JSON.stringify(respuestaAfip), idComprobante]
                    );
                    
                    await client.query('COMMIT');
                    
                    console.error(`❌ Comprobante rechazado por AFIP`);
                    
                    return {
                        success: false,
                        idComprobante,
                        error: 'Comprobante rechazado por AFIP',
                        detalles: errores
                    };
                }
                
            } catch (errorAfip) {
                console.error('⚠️ Error comunicación AFIP:', errorAfip.message);
                
                await client.query(`
                    UPDATE comprobantes_afip 
                    SET estado = $1, error_afip = $2, reintentos = 0, updated_at = NOW()
                    WHERE id_comprobante = $3`,
                    [this.ESTADOS.PENDIENTE_CAE, errorAfip.message, idComprobante]
                );
                
                await client.query('COMMIT');
                
                return {
                    success: false,
                    pendiente: true,
                    idComprobante,
                    mensaje: 'Comprobante guardado. AFIP no disponible - Se reintentará automáticamente',
                    error: errorAfip.message
                };
            }
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error en transacción:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    static async procesarComprobantesPendientes(pool, afipService) {
        console.log('🔄 Procesando comprobantes pendientes de CAE...');
        
        try {
            const pendientes = await pool.query(`
                SELECT * FROM comprobantes_afip 
                WHERE estado = $1 
                AND reintentos < 10
                ORDER BY created_at ASC
                LIMIT 50`,
                [this.ESTADOS.PENDIENTE_CAE]
            );
            
            console.log(`📋 ${pendientes.rows.length} comprobantes pendientes`);
            
            let exitosos = 0;
            let fallidos = 0;
            
            for (const comprobante of pendientes.rows) {
                try {
                    const facturaData = JSON.parse(comprobante.json_datos);
                    const respuesta = await afipService.generarFactura(facturaData);
                    
                    let detResponse;
                    if (Array.isArray(respuesta.FeDetResp.FECAEDetResponse)) {
                        detResponse = respuesta.FeDetResp.FECAEDetResponse[0];
                    } else {
                        detResponse = respuesta.FeDetResp.FECAEDetResponse;
                    }
                    
                    if (detResponse.Resultado === 'A') {
                        const cae = detResponse.CAE;
                        const vencimiento = detResponse.CAEFchVto;
                        
                        await pool.query(`
                            UPDATE comprobantes_afip 
                            SET estado = $1, cae = $2, cae_vencimiento = $3,
                                respuesta_afip = $4, updated_at = NOW()
                            WHERE id_comprobante = $5`,
                            [this.ESTADOS.AUTORIZADO, cae, vencimiento, 
                             JSON.stringify(respuesta), comprobante.id_comprobante]
                        );
                        
                        exitosos++;
                        console.log(`✅ CAE obtenido para comprobante ${comprobante.id_comprobante}: ${cae}`);
                    }
                    
                } catch (error) {
                    await pool.query(`
                        UPDATE comprobantes_afip 
                        SET reintentos = reintentos + 1, updated_at = NOW()
                        WHERE id_comprobante = $1`,
                        [comprobante.id_comprobante]
                    );
                    
                    fallidos++;
                    console.error(`❌ Error comprobante ${comprobante.id_comprobante}: ${error.message}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            console.log(`\n📊 Resumen: ${exitosos} exitosos, ${fallidos} fallidos`);
            return { exitosos, fallidos };
            
        } catch (error) {
            console.error('❌ Error en proceso de reintentos:', error.message);
            throw error;
        }
    }

    static async consultarEstadoComprobante(pool, idComprobante) {
        const result = await pool.query(
            'SELECT * FROM comprobantes_afip WHERE id_comprobante = $1',
            [idComprobante]
        );
        return result.rows[0];
    }
}

module.exports = EstrategiaContingencia;

'use strict';
const pool = require('/root/mi_erp/src/config/database');

const TABLAS = ['remito_items','remitos','precios','productos','producto_proveedor','facturas','pagos'];

async function cols(t) {
  const { rows } = await pool.query(
    `SELECT ordinal_position AS n, column_name, data_type,
            CASE WHEN is_nullable='NO' THEN 'NOT NULL' ELSE '' END AS nn,
            COALESCE(column_default,'') AS def
       FROM information_schema.columns
      WHERE table_name=$1
      ORDER BY ordinal_position`, [t]);
  return rows;
}
async function cons(t) {
  const { rows } = await pool.query(
    `SELECT conname, contype, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid = $1::regclass
      ORDER BY contype`, [t]);
  return rows;
}

(async () => {
  try {
    console.log('================ v_saldo_pedidos (causa raiz pedido 1) ================');
    try {
      const v = await pool.query(`SELECT pg_get_viewdef('v_saldo_pedidos', true) AS d`);
      console.log(v.rows[0].d);
    } catch (e) { console.log('  !! ' + e.message); }

    for (const t of TABLAS) {
      console.log('\n================ \\d ' + t + ' ================');
      try {
        const c = await cols(t);
        if (!c.length) { console.log('  (tabla no existe o sin columnas)'); continue; }
        for (const r of c) {
          console.log('  ' + String(r.n).padStart(2) + ' | ' +
            r.column_name.padEnd(28) + ' | ' + r.data_type.padEnd(20) + ' | ' +
            r.nn.padEnd(8) + ' | ' + r.def);
        }
        const k = await cons(t);
        if (k.length) {
          console.log('  -- constraints --');
          for (const r of k) console.log('     [' + r.contype + '] ' + r.conname + ': ' + r.def);
        }
      } catch (e) { console.log('  !! ' + e.message); }
    }

    console.log('\n================ [4] costo/precio congelado en remito_items ================');
    {
      const { rows } = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name='remito_items'
            AND (column_name ILIKE '%costo%' OR column_name ILIKE '%precio%')
          ORDER BY column_name`);
      rows.length ? rows.forEach(r => console.log('  ' + r.column_name + ' (' + r.data_type + ')'))
                  : console.log('  (sin columnas costo/precio en remito_items)');
    }

    console.log('\n================ [5] donde vive el stock ================');
    {
      const { rows } = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE column_name ILIKE '%stock%'
          ORDER BY table_name, column_name`);
      rows.length ? rows.forEach(r => console.log('  ' + r.table_name + '.' + r.column_name))
                  : console.log('  (ninguna columna *stock*)');
    }

    console.log('\n================ tablas stock/deposito ================');
    {
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public'
            AND (table_name ILIKE '%stock%' OR table_name ILIKE '%existencia%' OR table_name ILIKE '%deposito%')
          ORDER BY table_name`);
      rows.forEach(r => console.log('  ' + r.table_name));
    }
  } catch (e) {
    console.error('ERROR GLOBAL: ' + e.message);
  } finally {
    await pool.end();
  }
})();

'use client';

import { useState } from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 10, fontFamily: 'Helvetica' },
  titulo: { fontSize: 16, marginBottom: 4, fontWeight: 700 },
  subtitulo: { fontSize: 10, color: '#555', marginBottom: 16 },
  seccion: { fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 6 },
  filaHeader: { flexDirection: 'row', borderBottom: '1 solid #333', paddingBottom: 4, marginBottom: 4 },
  fila: { flexDirection: 'row', paddingVertical: 3, borderBottom: '0.5 solid #ddd' },
  celda: { flex: 1 },
  celdaHeader: { flex: 1, fontWeight: 700 },
  vacio: { fontSize: 10, color: '#888', marginBottom: 8 },
});

function formatoCLP(n) {
  return new Intl.NumberFormat('es-CL').format(n || 0);
}

function ReporteDocumento({ transacciones, movimientosFijos, tarjetas, metas, mesLabel }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.titulo}>Ábaco — Reporte Financiero</Text>
        <Text style={styles.subtitulo}>Periodo: {mesLabel}</Text>

        <Text style={styles.seccion}>Gastos Puntuales</Text>
        {transacciones.length === 0 ? (
          <Text style={styles.vacio}>Sin gastos registrados este mes.</Text>
        ) : (
          <>
            <View style={styles.filaHeader}>
              <Text style={styles.celdaHeader}>Fecha</Text>
              <Text style={styles.celdaHeader}>Comercio</Text>
              <Text style={styles.celdaHeader}>Categoría</Text>
              <Text style={styles.celdaHeader}>Monto CLP</Text>
            </View>
            {transacciones.map((t) => (
              <View style={styles.fila} key={t.id}>
                <Text style={styles.celda}>{new Date(t.fecha).toLocaleDateString('es-CL')}</Text>
                <Text style={styles.celda}>{t.comercio}</Text>
                <Text style={styles.celda}>{t.categorias?.nombre || 'otros'}</Text>
                <Text style={styles.celda}>{formatoCLP(t.monto_clp)}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.seccion}>Ingresos y Egresos Fijos</Text>
        {movimientosFijos.length === 0 ? (
          <Text style={styles.vacio}>Sin movimientos fijos registrados.</Text>
        ) : (
          <>
            <View style={styles.filaHeader}>
              <Text style={styles.celdaHeader}>Nombre</Text>
              <Text style={styles.celdaHeader}>Tipo</Text>
              <Text style={styles.celdaHeader}>Monto</Text>
              <Text style={styles.celdaHeader}>Día cobro</Text>
            </View>
            {movimientosFijos.map((m) => (
              <View style={styles.fila} key={m.id}>
                <Text style={styles.celda}>{m.nombre}</Text>
                <Text style={styles.celda}>{m.tipo}</Text>
                <Text style={styles.celda}>{formatoCLP(m.monto)} {m.moneda}</Text>
                <Text style={styles.celda}>{m.dia_cobro}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.seccion}>Estado de Tarjetas</Text>
        <View style={styles.filaHeader}>
          <Text style={styles.celdaHeader}>Alias</Text>
          <Text style={styles.celdaHeader}>Tipo</Text>
          <Text style={styles.celdaHeader}>Saldo</Text>
          <Text style={styles.celdaHeader}>Cupo</Text>
        </View>
        {tarjetas.map((t) => (
          <View style={styles.fila} key={t.id}>
            <Text style={styles.celda}>{t.alias}</Text>
            <Text style={styles.celda}>{t.tipo_producto}</Text>
            <Text style={styles.celda}>{formatoCLP(t.saldo_actual)} {t.moneda}</Text>
            <Text style={styles.celda}>{t.cupo_maximo ? formatoCLP(t.cupo_maximo) : '-'}</Text>
          </View>
        ))}

        <Text style={styles.seccion}>Metas de Ahorro</Text>
        {metas.length === 0 ? (
          <Text style={styles.vacio}>Sin metas registradas.</Text>
        ) : (
          <>
            <View style={styles.filaHeader}>
              <Text style={styles.celdaHeader}>Nombre</Text>
              <Text style={styles.celdaHeader}>Actual</Text>
              <Text style={styles.celdaHeader}>Objetivo</Text>
              <Text style={styles.celdaHeader}>Avance</Text>
            </View>
            {metas.map((m) => (
              <View style={styles.fila} key={m.id}>
                <Text style={styles.celda}>{m.nombre}</Text>
                <Text style={styles.celda}>{formatoCLP(m.monto_actual)}</Text>
                <Text style={styles.celda}>{formatoCLP(m.monto_objetivo)}</Text>
                <Text style={styles.celda}>{Math.round((m.monto_actual / m.monto_objetivo) * 100)}%</Text>
              </View>
            ))}
          </>
        )}
      </Page>
    </Document>
  );
}

function descargarBlob(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ReporteExport({ transacciones, movimientosFijos, tarjetas, metas, mesLabel }) {
  const [generando, setGenerando] = useState(null);

  async function exportarPDF() {
    setGenerando('pdf');
    const blob = await pdf(
      <ReporteDocumento
        transacciones={transacciones}
        movimientosFijos={movimientosFijos}
        tarjetas={tarjetas}
        metas={metas}
        mesLabel={mesLabel}
      />
    ).toBlob();
    descargarBlob(blob, `Abaco_Reporte_${mesLabel}.pdf`);
    setGenerando(null);
  }

  async function exportarExcelHandler() {
    setGenerando('excel');
    const { exportarExcel } = await import('@/lib/exportarDatos');
    exportarExcel({ transacciones, movimientosFijos, tarjetas, metas, mesLabel });
    setGenerando(null);
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={exportarExcelHandler}
        disabled={generando}
        className="px-3 py-1.5 rounded-lg border border-navy-700 text-navy-400 text-xs font-medium hover:text-gold disabled:opacity-60"
      >
        {generando === 'excel' ? 'Generando...' : 'Exportar Excel'}
      </button>
      <button
        onClick={exportarPDF}
        disabled={generando}
        className="px-3 py-1.5 rounded-lg border border-navy-700 text-navy-400 text-xs font-medium hover:text-gold disabled:opacity-60"
      >
        {generando === 'pdf' ? 'Generando...' : 'Exportar PDF'}
      </button>
    </div>
  );
}
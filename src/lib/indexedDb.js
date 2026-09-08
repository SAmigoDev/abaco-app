// src/lib/indexedDb.js
//
// Maneja dos cosas, según el Contrato de Datos §4:
// 1. La cola de transacciones pendientes por sincronizar (offline).
// 2. El caché local de regex_rules, versionado (§4.2).

const DB_NAME = 'abaco-db';
const DB_VERSION = 1;
const STORE_COLA = 'colaTransacciones';
const STORE_REGEX = 'regexCache';
const STORE_META = 'meta';

const MAX_INTENTOS = 3;
let isProcessing = false;

/** Abre (o crea) la base de datos IndexedDB del navegador. */
function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_COLA)) {
        const colaStore = db.createObjectStore(STORE_COLA, { keyPath: 'idLocal' });
        colaStore.createIndex('porTimestamp', 'timestamp', { unique: false });
        colaStore.createIndex('porSincronizado', 'sincronizado', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_REGEX)) {
        db.createObjectStore(STORE_REGEX, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'clave' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Envuelve un IDBRequest en una promesa. */
function promesaDeRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─────────────────────────────────────────────
// COLA DE TRANSACCIONES OFFLINE (§4.1 y §4.3)
// ─────────────────────────────────────────────

/**
 * Agrega un gasto a la cola local, con estado sincronizado: false.
 * `payload` debe ser el mismo objeto que espera POST /transacciones (§6).
 */
export async function agregarTransaccionCola(payload) {
  const db = await abrirDB();
  const registro = {
    idLocal: crypto.randomUUID(),
    payload,
    timestamp: new Date().toISOString(),
    sincronizado: false,
    intentos: 0,
  };

  const tx = db.transaction(STORE_COLA, 'readwrite');
  await promesaDeRequest(tx.objectStore(STORE_COLA).add(registro));
  return registro;
}

/** Devuelve las transacciones pendientes, ordenadas cronológicamente ascendente. */
export async function obtenerColaPendiente() {
  const db = await abrirDB();
  const tx = db.transaction(STORE_COLA, 'readonly');
  const todas = await promesaDeRequest(tx.objectStore(STORE_COLA).getAll());
  return todas
    .filter((r) => !r.sincronizado)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function actualizarRegistroCola(idLocal, mutarFn) {
  const db = await abrirDB();
  const tx = db.transaction(STORE_COLA, 'readwrite');
  const store = tx.objectStore(STORE_COLA);
  const registro = await promesaDeRequest(store.get(idLocal));
  if (registro) {
    mutarFn(registro);
    await promesaDeRequest(store.put(registro));
  }
  return registro;
}

async function marcarSincronizada(idLocal) {
  return actualizarRegistroCola(idLocal, (r) => {
    r.sincronizado = true;
  });
}

async function incrementarIntento(idLocal) {
  return actualizarRegistroCola(idLocal, (r) => {
    r.intentos += 1;
  });
}

async function marcarRequiereRevision(valor) {
  const db = await abrirDB();
  const tx = db.transaction(STORE_META, 'readwrite');
  await promesaDeRequest(
    tx.objectStore(STORE_META).put({ clave: 'requiereRevisionUsuario', valor })
  );
}

/** Consulta si la cola quedó detenida esperando revisión manual del usuario. */
export async function requiereRevisionUsuario() {
  const db = await abrirDB();
  const tx = db.transaction(STORE_META, 'readonly');
  const registro = await promesaDeRequest(
    tx.objectStore(STORE_META).get('requiereRevisionUsuario')
  );
  return registro?.valor ?? false;
}

/**
 * Procesa la cola con bloqueo de ejecución concurrente.
 */
export async function procesarColaOffline(enviarFn) {
  if (isProcessing) {
    return { procesado: 0, detenida: true, motivo: 'Procesamiento en curso' };
  }

  const yaBloqueada = await requiereRevisionUsuario();
  if (yaBloqueada) {
    return { procesado: 0, detenida: true, motivo: 'requiereRevisionUsuario ya estaba activo' };
  }

  isProcessing = true;
  let procesados = 0;

  try {
    const pendientes = await obtenerColaPendiente();

    for (const registro of pendientes) {
      let resultado;
      try {
        resultado = await enviarFn(registro.payload);
      } catch (err) {
        resultado = { ok: false, error: err };
      }

      if (resultado?.ok) {
        await marcarSincronizada(registro.idLocal);
        procesados++;
        continue;
      }

      const actualizado = await incrementarIntento(registro.idLocal);

      if (actualizado.intentos >= MAX_INTENTOS) {
        await marcarRequiereRevision(true);
        return {
          procesado: procesados,
          detenida: true,
          motivo: `La transacción ${registro.idLocal} superó ${MAX_INTENTOS} intentos`,
        };
      }

      return { procesado: procesados, detenida: true, motivo: 'Reintentando registro fallido' };
    }

    return { procesado: procesados, detenida: false };
  } finally {
    isProcessing = false;
  }
}

/** Limpia la bandera de revisión manual. */
export async function limpiarRequiereRevision() {
  await marcarRequiereRevision(false);
}

/** Registra listener de reconexión automático. */
export function registrarListenerReconexion(enviarFn) {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      procesarColaOffline(enviarFn);
    });
  }
}

// ─────────────────────────────────────────────
// CACHÉ DE regex_rules CON VERSIONADO (§4.2)
// ─────────────────────────────────────────────

export async function guardarCacheRegex(reglas, versionGlobal) {
  const db = await abrirDB();
  const tx = db.transaction(STORE_REGEX, 'readwrite');
  await promesaDeRequest(
    tx.objectStore(STORE_REGEX).put({ id: 'cache', reglas, versionGlobal })
  );
}

export async function obtenerCacheRegex() {
  const db = await abrirDB();
  const tx = db.transaction(STORE_REGEX, 'readonly');
  const registro = await promesaDeRequest(tx.objectStore(STORE_REGEX).get('cache'));
  return registro ? { reglas: registro.reglas, versionGlobal: registro.versionGlobal } : null;
}

export async function sincronizarCacheRegex(obtenerVersionRemotaFn, obtenerReglasRemotasFn) {
  const local = await obtenerCacheRegex();
  const versionRemota = await obtenerVersionRemotaFn();

  if (local && local.versionGlobal === versionRemota) {
    return { actualizado: false, reglas: local.reglas };
  }

  const reglas = await obtenerReglasRemotasFn();
  await guardarCacheRegex(reglas, versionRemota);
  return { actualizado: true, reglas };
}
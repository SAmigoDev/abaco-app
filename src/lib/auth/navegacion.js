// A fresh document after auth changes discards cached data from the prior session.
// Call only with destinations produced by rutas.mjs or fixed local auth paths.
export function navegarTrasAutenticacion(destino) {
  window.location.replace(destino);
}

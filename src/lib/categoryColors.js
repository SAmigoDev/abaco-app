export const COLOR_CATEGORIA = {
  comida: '#E1B168',
  transporte: '#6C90C3',
  entretencion: '#9B7FD4',
  salud: '#E15554',
  hogar: '#3FA796',
  suscripciones: '#C97FB0',
  otros: '#7C89A3',
};

export function colorDeCategoria(nombre) {
  return COLOR_CATEGORIA[nombre] || COLOR_CATEGORIA.otros;
}
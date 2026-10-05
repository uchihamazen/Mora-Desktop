export const products = [
  {id:'coffee',name:'Café coffee',category:'drinks',price:120,stock:12},
  {id:'tea',name:'شاي أخضر',category:'drinks',price:60,stock:0},
  {id:'mug',name:'Ceramic mug',category:'home',price:85,stock:8}
];

export function searchProducts(query = '') {
  return products.filter(product => product.name.toLowerCase().includes(query.toLowerCase()));
}

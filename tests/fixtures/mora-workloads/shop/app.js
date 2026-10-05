import {products,searchProducts} from './catalog.js';
import {checkout} from './checkout.js';

const lines = [];
const search = document.querySelector('#search');
function renderProducts() {
  document.querySelector('#products').replaceChildren(...searchProducts(search.value).map(product => {
    const button = document.createElement('button');
    button.textContent = `Add ${product.name}`;
    button.disabled = product.stock === 0;
    button.onclick = () => {lines.push({id:product.id,price:product.price,quantity:1});renderTotal();};
    return button;
  }));
}
function renderTotal() {
  const summary = checkout(lines, document.querySelector('#zone').value, {coupon:document.querySelector('#coupon').value});
  document.querySelector('#total').textContent = lines.length ? `EGP ${summary.total.toFixed(2)}` : 'Your basket is empty';
}
search.oninput = renderProducts;
document.querySelector('#coupon').oninput = renderTotal;
document.querySelector('#zone').onchange = renderTotal;
renderProducts();renderTotal();

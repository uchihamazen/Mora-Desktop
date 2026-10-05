import {basketSummary} from './basket.js';
import {deliveryEstimate} from './delivery.js';

export function checkout(lines, zone, options = {}) {
  const basket = basketSummary(lines, options);
  const delivery = deliveryEstimate(zone, {subtotal:basket.total,express:options.express});
  return {items:basket.count,subtotal:basket.subtotal,discount:basket.discount || 0,shipping:delivery.fee,total:Math.round((basket.total + delivery.fee) * 100) / 100,days:delivery.days};
}

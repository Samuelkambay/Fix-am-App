import { config } from '../../../config.js';
import { badRequest } from '../../../lib/errors.js';
import { HttpMerchantGateway } from './http-merchant.js';
import { OrangeWebPayGateway } from './orange-webpay.js';
import { SandboxGateway } from './sandbox.js';
import { GATEWAY_CODES, GatewayNotConfiguredError, type GatewayCode, type MobileMoneyGateway } from './types.js';

export * from './types.js';

const cache = new Map<string, MobileMoneyGateway>();

function build(code: GatewayCode): MobileMoneyGateway {
  if (config.paymentMode === 'sandbox') return new SandboxGateway(code);
  switch (code) {
    case 'orange_money':
      if (OrangeWebPayGateway.isConfigured()) return new OrangeWebPayGateway();
      if (HttpMerchantGateway.isConfigured('ORANGE_MONEY')) return new HttpMerchantGateway(code, 'Orange Money', 'orange', 'ORANGE_MONEY');
      break;
    case 'afrimoney':
      if (HttpMerchantGateway.isConfigured('AFRIMONEY')) return new HttpMerchantGateway(code, 'Afrimoney', 'africell', 'AFRIMONEY');
      break;
    case 'qmoney':
      if (HttpMerchantGateway.isConfigured('QMONEY')) return new HttpMerchantGateway(code, 'QMoney', 'qcell', 'QMONEY');
      break;
    case 'monime':
      if (HttpMerchantGateway.isConfigured('MONIME')) return new HttpMerchantGateway(code, 'Monime', null, 'MONIME');
      break;
  }
  throw new GatewayNotConfiguredError(`${code} is not configured`);
}

export function isGatewayCode(code: string): code is GatewayCode {
  return (GATEWAY_CODES as string[]).includes(code);
}

export function getGateway(code: string): MobileMoneyGateway {
  if (!isGatewayCode(code)) throw badRequest('unknown_gateway', `Unknown payment method ${code}`);
  let gw = cache.get(code);
  if (!gw) {
    try {
      gw = build(code);
    } catch (e) {
      if (e instanceof GatewayNotConfiguredError) throw badRequest('gateway_unavailable', `${code} payments are not available yet`);
      throw e;
    }
    cache.set(code, gw);
  }
  return gw;
}

export function availableGateways() {
  return GATEWAY_CODES.flatMap((code) => {
    try {
      const gw = getGateway(code);
      return [{ code, name: gw.displayName, operator: gw.operator, sandbox: config.paymentMode === 'sandbox' }];
    } catch {
      return [];
    }
  });
}

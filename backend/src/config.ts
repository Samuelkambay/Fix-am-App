function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var ${name}`);
  }
  return v;
}

const nodeEnv = env('NODE_ENV', 'development');

if (nodeEnv === 'production' && !process.env.USSD_SHARED_SECRET) {
  console.warn('USSD_SHARED_SECRET is not set: the USSD endpoint will accept requests from anyone.');
}

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(env('PORT', '4000')),
  databaseUrl: env('DATABASE_URL', 'postgres://fixam:fixam@localhost:5432/fixam'),
  jwtSecret: env('JWT_SECRET', nodeEnv === 'production' ? undefined : 'dev-only-secret-change-me'),
  publicBaseUrl: env('PUBLIC_BASE_URL', 'http://localhost:4000'),
  timezone: 'Africa/Freetown',
  currency: 'SLE',
  smsProvider: env('SMS_PROVIDER', 'console'),
  paymentMode: env('PAYMENT_MODE', 'sandbox') as 'sandbox' | 'live',
  accessTokenTtlSec: 60 * 60,
  refreshTokenTtlDays: 30,
  otpTtlSec: 5 * 60,
  otpMaxAttempts: 5,
  otpMaxPerWindow: 3,
  otpWindowSec: 10 * 60,
  quoteTtlSec: 15 * 60,
  paymentTtlSec: 15 * 60,
  ussdSharedSecret: process.env.USSD_SHARED_SECRET ?? '',
  // Exposes OTP codes in API responses outside production so the apps can be demoed without an SMS gateway.
  // A public demo without an SMS gateway sets EXPOSE_DEV_OTP=true so testers can log in. Never on a real launch.
  exposeDevOtp: process.env.EXPOSE_DEV_OTP ? process.env.EXPOSE_DEV_OTP === 'true' : nodeEnv !== 'production',
};

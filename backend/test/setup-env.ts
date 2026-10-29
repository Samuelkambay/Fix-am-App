// Runs before any app module is imported, so config.ts picks these up.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://fixam:fixam@localhost:5432/fixam_test';
process.env.PAYMENT_MODE = 'sandbox';
process.env.SANDBOX_AUTO_APPROVE_SEC = '3600'; // tests drive outcomes explicitly via /simulate
process.env.JWT_SECRET = 'test-secret';
process.env.UPLOAD_DIR = '/tmp/fixam-test-uploads';

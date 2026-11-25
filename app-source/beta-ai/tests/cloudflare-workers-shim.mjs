// Minimal test-only substitute for the Cloudflare runtime base class.
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

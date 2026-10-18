# Testing the proxy matcher

The bundled `proxy.md` docs name `unstable_doesProxyMatch`, but the installed `next/experimental/testing/server` only exports `unstable_doesMiddlewareMatch`. It takes the same `{ config, url }` and works on `src/proxy.ts`'s `config` (see `src/proxy.test.ts`). Run the test in the `node` environment.

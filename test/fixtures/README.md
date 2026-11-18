# Test fixtures — intentionally public, test-only

These files exist only for `backend/test/*.test.ts`. They are **not secrets**. Nothing outside the tests trusts them.

| File | What it is | Used by |
|---|---|---|
| `test-ca.crt` | Self-signed certificate. Its private key was deleted when it was generated. | `env.test.ts`, `database.test.ts` (as an *unrelated* CA) |
| `tls-localhost.crt` | Self-signed certificate valid only for `DNS:localhost` | `database.test.ts` (fake TLS PostgreSQL server) |
| `tls-localhost.key` | **Private key for `tls-localhost.crt`, committed on purpose** | `database.test.ts` only |

## Rules

- **Never reuse these files** for any real server, development database, proxy, or certificate store. Anyone with the repository has the key.
- Never add them to a trust store, and never point `DATABASE_CA_CERT_PATH` at them outside tests.
- They are not part of the production build: `backend/tsconfig.json` compiles only `src/` into `dist/`, and the `test/` folder is not copied.
- If a secret scanner flags `tls-localhost.key`, this README is the explanation. The key protects nothing.
- To regenerate them, create new self-signed files with `openssl req -x509 …`. Never copy a real key here.

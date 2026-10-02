import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

let installed = false;
/**
 * If the process runs behind an HTTP(S) proxy (HTTPS_PROXY set), route global
 * fetch through it. NO_PROXY is respected, so localhost fixtures stay direct.
 * No-op in a normal deployment.
 */
export function installProxyFromEnv(): void {
  if (installed) return;
  installed = true;
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}

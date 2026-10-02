import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStaticServer } from "../packages/core/test/helpers/static-server.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sites");
const port = Number(process.env.FIXTURE_PORT ?? 8099);
startStaticServer(root, port).then(({ url }) => console.log(`Fixture sites at ${url}/acme/ ${url}/globex/ ${url}/initech/`));

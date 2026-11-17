import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';

export async function listenHttp(server, host = '127.0.0.1') {
  for (let attempt = 0; attempt < 32; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const listening = () => { server.off('error', failed); resolve(); };
        const failed = (error) => { server.off('listening', listening); reject(error); };
        server.once('error', failed);
        server.once('listening', listening);
        server.listen({ host, port: randomInt(49_152, 65_536), exclusive: true });
      });
      return server.address().port;
    } catch (error) {
      if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error;
    }
  }
  throw new Error('No available HTTP fixture port in the dynamic/private range');
}

export async function availableHttpPort() {
  const server = createServer();
  const port = await listenHttp(server);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

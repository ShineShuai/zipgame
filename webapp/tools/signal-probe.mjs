// Tries the MQTT brokers of the co-op trial from THIS network, with the very client the page uses
// (src/coop/mqtt.js): connect, a live message to a second client, and a retained message to a
// third. Run it where players are (China, Europe ...) before changing SIGNAL_BROKERS.
//   node tools/signal-probe.mjs [--broker <wss url>]... [--timeout <ms>]
// Needs Node 22+ (the global WebSocket). Exit code 1 when no broker works.
import { SIGNAL_BROKERS } from '../src/coop/config.js';
import { createMqtt } from '../src/coop/mqtt.js';

const args = process.argv.slice(2);
const valuesOf = name => args.flatMap((arg, i) => (arg === name ? [args[i + 1]] : []));
const timeout = Number(valuesOf('--timeout')[0] ?? 8000);
const urls = valuesOf('--broker');
const brokers = urls.length ? urls.map(url => ({ id: url, url })) : SIGNAL_BROKERS;
if (typeof WebSocket !== 'function' || !(timeout > 0) || args.includes('--help')) {
  console.error('usage: signal-probe.mjs [--broker <wss url>]... [--timeout <ms>] (Node 22+)');
  process.exit(2);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hex = () => Math.random().toString(16).slice(2, 10);

// A connected client whose messages can be waited for: -> { client, wait(topic) }.
const connect = url => new Promise((resolve, reject) => {
  const waiting = new Map();
  const timer = setTimeout(() => reject(new Error('no connection')), timeout);
  const client = createMqtt({
    url,
    clientId: `zp${hex()}${hex()}`,
    WebSocketImpl: WebSocket,
    onopen() {
      clearTimeout(timer);
      resolve({
        client,
        wait: topic => new Promise((done, fail) => {
          waiting.set(topic, done);
          setTimeout(() => fail(new Error(`nothing on ${topic}`)), timeout);
        }),
      });
    },
    onmessage: (topic, text) => waiting.get(topic)?.(text),
    onclose: () => reject(new Error('closed')),
  });
});

async function probe({ url }) {
  const topic = `zipcoop/probe/${hex()}${hex()}`;
  const clients = [];
  try {
    let began = performance.now();
    const a = await connect(url);
    clients.push(a.client);
    const connectMs = Math.round(performance.now() - began);

    const b = await connect(url);
    clients.push(b.client);
    b.client.subscribe(`${topic}/live`);
    await sleep(300); // a subscription is not confirmed to the client: give the broker a moment
    began = performance.now();
    const live = b.wait(`${topic}/live`);
    a.client.publish(`${topic}/live`, 'live');
    await live;
    const liveMs = Math.round(performance.now() - began);

    a.client.publish(`${topic}/kept`, 'kept', true);
    await sleep(300);
    began = performance.now();
    const c = await connect(url);
    clients.push(c.client);
    const kept = c.wait(`${topic}/kept`);
    c.client.subscribe(`${topic}/kept`);
    await kept;
    const keptMs = Math.round(performance.now() - began);
    a.client.publish(`${topic}/kept`, '', true); // remove it again
    await sleep(100);
    return `ok   connect ${connectMs} ms · live ${liveMs} ms · retained ${keptMs} ms`;
  } catch (error) {
    return `FAIL ${error.message}`;
  } finally {
    clients.forEach(client => client.close());
  }
}

const results = await Promise.all(brokers.map(async broker => [broker, await probe(broker)]));
for (const [broker, line] of results) {
  console.log(`${broker.id.padEnd(4)} ${broker.url}  ${line}`);
}
const working = results.filter(([, line]) => line.startsWith('ok')).length;
console.log(`${working} of ${brokers.length} brokers work from here`);
process.exit(working > 0 ? 0 : 1);

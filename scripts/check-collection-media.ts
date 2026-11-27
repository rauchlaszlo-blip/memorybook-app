import { assertMediaToolsReady } from '../server/collection/av-decoder';

await assertMediaToolsReady();
console.log('Collection media tools are available.');

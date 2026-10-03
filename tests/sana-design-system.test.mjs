import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const app = new URL('../app/', import.meta.url);
test('SANA presentation tokens resolve without missing references or cycles', async () => {
  const source = await readFile(new URL('sana-tokens.css', app), 'utf8');
  const tokens = new Map([...source.matchAll(/(--sana-[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2]]));
  function resolve(name, chain = []) {
    assert.ok(tokens.has(name), `Missing token ${name}`);
    assert.ok(!chain.includes(name), `Cyclic token: ${[...chain, name].join(' → ')}`);
    for (const reference of tokens.get(name).matchAll(/var\((--sana-[\w-]+)/g)) resolve(reference[1], [...chain, name]);
  }
  for (const name of tokens.keys()) resolve(name);
  const files = (await readdir(app, { recursive: true })).filter(name => /\.(css|tsx)$/.test(name));
  for (const name of files) {
    const content = await readFile(new URL(name.replaceAll('\\', '/'), app), 'utf8');
    for (const reference of content.matchAll(/var\((--sana-[\w-]+)/g)) {
      assert.ok(tokens.has(reference[1]), `${name} uses undefined ${reference[1]}`);
    }
  }
});

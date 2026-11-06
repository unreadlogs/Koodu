import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { downloadModel } from 'cactus-needle';

/**
 * Provisions the pinned Needle 3 weights. With no argument it downloads (or
 * reuses) the verified package cache under XDG_CACHE_HOME/~/.cache. With an
 * argument it copies the verified file there, e.g. assets/models/needle3.cact.
 */
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;

try {
  const cachePath = await downloadModel({ model: 'needle3' });

  if (!target) {
    console.log(`Needle 3 ready: ${cachePath}`);
    console.log('Local inference is enabled with LOCAL_LLM_PROVIDER=needle in .env.');
    process.exit(0);
  }

  if (path.resolve(cachePath) === target) {
    console.log(`Needle 3 already at target: ${target}`);
    process.exit(0);
  }

  const targetDir = path.dirname(target);
  await mkdir(targetDir, { recursive: true });

  const temp = `${target}.tmp-${process.pid}`;
  await copyFile(cachePath, temp);
  try {
    const [source, copied] = await Promise.all([stat(cachePath), stat(temp)]);
    if (source.size !== copied.size || copied.size !== 35_335_380) {
      throw new Error('needle3.cact copy size mismatch; leaving no partial file.');
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }

  console.log(`Needle 3 ready: ${target}`);
  console.log(`Set NEEDLE_MODEL_PATH=${target} in .env (or equivalent absolute path).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Needle 3 download failed.');
  process.exitCode = 1;
}

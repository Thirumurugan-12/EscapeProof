import { mkdir, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Credentials arrive only through the hosting provider's private variables.
// Seed once; subsequent OAuth refreshes stay on the persistent volume.
if (process.env.KANE_PROFILE_SEED_BASE64) {
  const files = JSON.parse(Buffer.from(process.env.KANE_PROFILE_SEED_BASE64, 'base64').toString());
  const allowed = ['config.json', 'profiles/default/prod/credentials', 'profiles/default/prod/client.json', 'profiles/default/prod/profile-config.json'];
  for (const name of allowed) {
    if (typeof files[name] !== 'string') continue;
    const target = join(homedir(), '.testmuai', 'kaneai', name);
    await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
    try { await access(target); } catch { await writeFile(target, files[name], { mode: 0o600, flag: 'wx' }); }
  }
}

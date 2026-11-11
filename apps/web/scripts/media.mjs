/** Cross-platform entry point for the local Python media tool. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const result=spawnSync(process.platform==='win32'?'py':'python3',[fileURLToPath(new URL('../../../scripts/media/media.py',import.meta.url)),...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
if(result.error){console.error(result.error.message);process.exit(1);}
process.exit(result.status??1);

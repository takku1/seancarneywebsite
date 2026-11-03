/**
 * Fail fast on malformed content files.
 *
 * Astro's file() loader logs "Error reading data from src/data/x.json" for a
 * JSON syntax error and then CONTINUES with that collection empty: the build
 * (and CI) still exit 0, so one missing comma would ship a site with, say,
 * every press quote silently gone. This integration parses each data file at
 * config setup (dev, build, check/sync) and stops with the file, line and
 * column instead. Schema mistakes (wrong types) are already fatal in Astro.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Turn a JSON.parse position into line:column for a human. */
function locate(text, message) {
  const m = /position (\d+)/.exec(message) ?? /line (\d+) column (\d+)/.exec(message);
  if (!m) return '';
  if (m.length === 3) return ` (line ${m[1]}, column ${m[2]})`;
  const before = text.slice(0, Number(m[1]));
  const line = before.split('\n').length;
  return ` (line ${line}, column ${Number(m[1]) - before.lastIndexOf('\n')})`;
}

export default function validateData({ dir = 'src/data' } = {}) {
  return {
    name: 'validate-data',
    hooks: {
      'astro:config:setup': async ({ config, logger }) => {
        const root = fileURLToPath(config.root);
        const dataDir = path.join(root, dir);
        let files = [];
        try {
          files = (await readdir(dataDir)).filter((f) => f.endsWith('.json'));
        } catch {
          return; // no data directory
        }
        const problems = [];
        for (const f of files) {
          const text = await readFile(path.join(dataDir, f), 'utf8');
          try {
            JSON.parse(text);
          } catch (err) {
            problems.push(`${dir}/${f}${locate(text, String(err.message))}: ${err.message}`);
          }
        }
        if (problems.length) {
          throw new Error(
            `Content file is not valid JSON, so the build stopped (otherwise that section would silently disappear from the site):\n  ${problems.join('\n  ')}\nCommon causes: a missing or extra comma, or an unclosed quote or bracket.`,
          );
        }
        logger.info(`${files.length} data files OK`);
      },
    },
  };
}

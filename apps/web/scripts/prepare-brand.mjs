/** Export SCE's code-native wordmark for browser and install icons. */
import sharp from 'sharp';
import {writeFile} from 'node:fs/promises';
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#f3efe7"/><text x="256" y="325" text-anchor="middle" font-family="Georgia,serif" font-size="185" fill="#24201b">SCE</text></svg>');
await writeFile('public/favicon.svg',svg);
for(const [file,size] of [['favicon-32.png',32],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512]])await sharp(svg).resize(size,size).png().toFile(`public/${file}`);
console.log('Prepared SCE browser and install icons.');

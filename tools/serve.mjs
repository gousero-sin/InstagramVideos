// Preview ao vivo no navegador (com GPU real roda a 60 fps, com áudio e scrub).
//   npm run dev  →  http://localhost:5173/reels/planilha-para-sistema/
import path from 'node:path';
import { createServer } from './server.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = +(process.env.PORT || 5173);
const server = await createServer({ root, port });
console.log(`preview: http://localhost:${server.address().port}/reels/planilha-para-sistema/`);
console.log('atalhos: espaço = play/pause · ←/→ = quadro a quadro · ?t=12.5 abre num tempo');

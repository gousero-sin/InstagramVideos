// Identidade visual + roteiro. Troque aqui para adaptar o reel (cores, textos, @).
import { Beat } from '../../engine/core/time.js';

export const BPM = 128; // 16 compassos de 4 tempos = 30,0 s exatos
export const beat = new Beat(BPM);
export const B = (n) => beat.s(n); // tempo (s) do beat n

export const HANDLE = '@gouserodev';

// Paleta herdada do estilo dos projetos (AnimTOXIC / GoFlow): preto profundo,
// verde "toxic" neon, vermelho de alerta e branco frio.
export const C = {
  bg: '#020304',
  ink: '#07090b',
  panel: '#0b0f0e',
  white: '#f3f6f4',
  dim: '#8a9690',
  green: '#39ff14',
  greenSoft: '#a8ff8a',
  greenDeep: '#0f3d06',
  red: '#ff003c',
  redSoft: '#ff5c7a',
  cyan: '#35c7f2',
};

// Famílias registradas no canvas (FontFace) — ver main.js
export const F = {
  hero: 'Archivo XC', // Extra Condensed Black — palavras gigantes
  heroC: 'Archivo C', // Condensed Black
  sans: 'Archivo', // 600 / 800 / 900
  wide: 'Archivo X', // Expanded Black — logotipo
  mono: 'JetBrains Mono', // 500 / 700
};

export const COPY = {
  hook: ['SUA EMPRESA', 'AINDA RODA EM'],
  hookWord: 'PLANILHA?',
  joke: '// ctrl+c · ctrl+v · e reza',
  pains: [
    { l1: 'FÓRMULA', l2: 'QUEBRADA.', tag: '#REF!' },
    { l1: 'RETRABALHO', l2: 'TODO DIA.', tag: '#VALOR!' },
    { l1: 'DINHEIRO', l2: 'ESCAPANDO.', tag: '#N/D' },
  ],
  turn: ['TROQUE', 'O CAOS'],
  drop1: 'POR UM',
  dropWord: 'SISTEMA.',
  tailor: ['FEITO SOB MEDIDA', 'PRO SEU NEGÓCIO.'],
  city: ['SEUS NÚMEROS', 'EM TEMPO REAL.'],
  zero: ['ZERO', 'RETRABALHO.'],
  servicesKicker: '// O QUE EU CONSTRUO',
  services: [
    { title: 'SISTEMAS WEB', sub: 'SaaS · ERP · painéis' },
    { title: 'CRM DE VENDAS', sub: 'leads · funil · follow-up' },
    { title: 'AUTOMAÇÃO + IA', sub: 'processos no piloto automático' },
    { title: 'SITES & APPS', sub: 'rápidos, modernos, que vendem' },
  ],
  control: ['DO CAOS', 'AO CONTROLE.'],
  ctaKicker: ['BORA TIRAR SUA EMPRESA', 'DA PLANILHA?'],
  ctaButton: 'MANDA “SISTEMA” NO DIRECT',
  ctaSub: 'sistemas · dashboards · automação · IA',
};

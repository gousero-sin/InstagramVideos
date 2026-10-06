import * as THREE from 'three';
import { canvasTexture, makeTextMaterial } from '../../../engine/gfx/text2d.js';
import { C, F } from '../config.js';

// Elementos de interface desenhados proceduralmente em canvas (viram texturas 3D).

export function canvas(w, h, ss = 2) {
  const c = document.createElement('canvas');
  c.width = w * ss;
  c.height = h * ss;
  const ctx = c.getContext('2d');
  ctx.scale(ss, ss);
  return { c, ctx, w, h };
}

const rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

// Janela de erro "não está respondendo" (o pesadelo de toda planilha)
export function errorDialogTexture(variant = 0) {
  const { c, ctx, w, h } = canvas(560, 250);
  ctx.fillStyle = '#16191a';
  rr(ctx, 2, 2, w - 4, h - 4, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // barra de título
  ctx.fillStyle = '#23282a';
  rr(ctx, 2, 2, w - 4, 46, [10, 10, 0, 0]);
  ctx.fill();
  ctx.fillStyle = '#c8d0cc';
  ctx.font = `500 19px "${F.mono}"`;
  ctx.textBaseline = 'middle';
  const titles = ['planilha_FINAL_v7_agora_vai.xlsx', 'fluxo_caixa_REVISADO(3).xlsx', 'DRE_NAO_MEXER.xlsx'];
  ctx.fillText(titles[variant % titles.length], 18, 26);
  ctx.fillStyle = C.red;
  rr(ctx, w - 50, 12, 32, 26, 5);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 20px "${F.mono}"`;
  ctx.fillText('×', w - 40, 26);
  // ícone de alerta
  ctx.fillStyle = '#ffcc1a';
  ctx.beginPath();
  ctx.moveTo(52, 78);
  ctx.lineTo(86, 140);
  ctx.lineTo(18, 140);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#16191a';
  ctx.font = `900 38px "${F.sans}"`;
  ctx.textAlign = 'center';
  ctx.fillText('!', 52, 120);
  ctx.textAlign = 'left';
  // mensagem
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 27px "${F.sans}"`;
  const msgs = [['A planilha não está', 'respondendo.'], ['Referência circular', 'detectada.'], ['Arquivo corrompido.', 'Deseja recuperar?']];
  const m = msgs[variant % msgs.length];
  ctx.fillText(m[0], 108, 92);
  ctx.fillText(m[1], 108, 126);
  // botões
  const btn = (x, label, primary) => {
    ctx.fillStyle = primary ? '#2b3134' : 'transparent';
    rr(ctx, x, 180, 180, 46, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
    ctx.fillStyle = '#dfe6e2';
    ctx.font = `600 20px "${F.sans}"`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + 90, 204);
    ctx.textAlign = 'left';
  };
  btn(w - 392, 'Aguardar', false);
  btn(w - 200, 'Fechar', true);
  return canvasTexture(c);
}

export function makeErrorDialog(variant, scale = 1) {
  const tex = errorDialogTexture(variant);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.86 * scale, 0.83 * scale),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false })
  );
  m.renderOrder = 10;
  return m;
}

// ───────────────────────── Dashboard (cards de vidro) ─────────────────────────

export function card(ctx, w, h, o = {}) {
  const r = o.radius ?? 22;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, o.top ?? 'rgba(18,30,24,0.94)');
  g.addColorStop(1, o.bottom ?? 'rgba(6,10,8,0.94)');
  ctx.fillStyle = g;
  rr(ctx, 3, 3, w - 6, h - 6, r);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = o.border ?? 'rgba(57,255,20,0.32)';
  ctx.stroke();
  // brilho na borda superior
  const hl = ctx.createLinearGradient(0, 0, w, 0);
  hl.addColorStop(0, 'rgba(255,255,255,0)');
  hl.addColorStop(0.5, 'rgba(190,255,180,0.35)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(r, 3, w - 2 * r, 2);
}

export function label(ctx, s, x, y, o = {}) {
  ctx.font = `${o.weight ?? 700} ${o.size ?? 18}px "${o.family ?? F.mono}"`;
  ctx.letterSpacing = `${o.ls ?? 2}px`;
  ctx.fillStyle = o.color ?? '#8fa699';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.textAlign = o.align ?? 'left';
  ctx.fillText(s, x, y);
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
}

export function chip(ctx, s, x, y, o = {}) {
  ctx.font = `700 ${o.size ?? 17}px "${F.mono}"`;
  const w = ctx.measureText(s).width + 22;
  ctx.fillStyle = o.bg ?? 'rgba(57,255,20,0.14)';
  rr(ctx, x, y - 17, w, 30, 15);
  ctx.fill();
  ctx.fillStyle = o.color ?? C.green;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x + 11, y - 1);
  ctx.textBaseline = 'alphabetic';
  return w;
}

const CASH = [31, 37, 34, 43, 40, 51, 47, 57, 63, 59, 71, 84];
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

// Painel principal: fluxo de caixa. Retorna camadas (fundo estático + gráfico revelável).
export function cashPanel() {
  const W = 900, H = 560;
  const bg = canvas(W, H);
  card(bg.ctx, W, H);
  const ctx = bg.ctx;
  ctx.fillStyle = C.green;
  ctx.beginPath();
  ctx.arc(38, 50, 6, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, 'FLUXO DE CAIXA · 2025', 56, 57, { color: '#b9cfc2', size: 19 });
  label(ctx, 'R$ 84,2 mil', 34, 128, { family: F.sans, weight: 800, size: 54, ls: -1, color: '#ffffff' });
  chip(ctx, '▲ 18,4%', 340, 112);
  label(ctx, 'saldo projetado', 34, 162, { family: F.sans, weight: 600, size: 18, ls: 0, color: '#6f8579' });
  // grade do gráfico
  const x0 = 40, x1 = W - 40, y0 = 210, y1 = H - 60;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 4; i++) {
    const y = y0 + ((y1 - y0) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  MONTHS.forEach((m, i) => label(ctx, m, x0 + ((x1 - x0) * i) / 11, H - 26, { size: 14, align: 'center', color: '#5f7568', ls: 1 }));
  // camada do gráfico
  const fg = canvas(W, H);
  const f = fg.ctx;
  const pts = CASH.map((v, i) => [x0 + ((x1 - x0) * i) / 11, y1 - ((v - 20) / 70) * (y1 - y0)]);
  const path = () => {
    f.beginPath();
    f.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const mx = (ax + bx) / 2;
      f.bezierCurveTo(mx, ay, mx, by, bx, by);
    }
  };
  const grad = f.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, 'rgba(57,255,20,0.42)');
  grad.addColorStop(1, 'rgba(57,255,20,0)');
  path();
  f.lineTo(x1, y1);
  f.lineTo(x0, y1);
  f.closePath();
  f.fillStyle = grad;
  f.fill();
  path();
  f.lineWidth = 5;
  f.strokeStyle = C.green;
  f.shadowColor = 'rgba(57,255,20,0.9)';
  f.shadowBlur = 16;
  f.stroke();
  f.shadowBlur = 0;
  pts.forEach(([x, y], i) => {
    if (i % 2 === 1 || i === 11) {
      f.fillStyle = '#04110a';
      f.beginPath();
      f.arc(x, y, 7, 0, Math.PI * 2);
      f.fill();
      f.lineWidth = 3;
      f.strokeStyle = C.green;
      f.stroke();
    }
  });
  // tooltip no último ponto
  const [tx, ty] = pts[11];
  f.fillStyle = 'rgba(57,255,20,0.95)';
  rr(f, tx - 150, ty - 66, 128, 44, 10);
  f.fill();
  f.fillStyle = '#031006';
  f.font = `800 22px "${F.sans}"`;
  f.fillText('R$ 84,2k', tx - 138, ty - 37);
  return { bg: canvasTexture(bg.c), fg: canvasTexture(fg.c), w: W, h: H };
}

export function kpiCard(title, sub, o = {}) {
  const W = o.w ?? 430, H = o.h ?? 230;
  const { c, ctx } = canvas(W, H);
  card(ctx, W, H);
  label(ctx, title, 30, 52, { color: '#b9cfc2', size: 17 });
  if (o.icon) {
    ctx.fillStyle = 'rgba(57,255,20,0.14)';
    rr(ctx, W - 72, 26, 44, 44, 12);
    ctx.fill();
    ctx.fillStyle = C.green;
    ctx.font = `800 24px "${F.sans}"`;
    ctx.textAlign = 'center';
    ctx.fillText(o.icon, W - 50, 57);
    ctx.textAlign = 'left';
  }
  if (sub) chip(ctx, sub, 28, H - 44, o.chip || {});
  return { tex: canvasTexture(c), w: W, h: H };
}

export function tableCard() {
  const W = 620, H = 380;
  const { c, ctx } = canvas(W, H);
  card(ctx, W, H);
  label(ctx, 'ÚLTIMAS VENDAS', 30, 52, { color: '#b9cfc2', size: 17 });
  const rows = [
    ['Mercado Silva', 'R$ 12.480', 'PAGO'],
    ['Auto Peças JR', 'R$ 8.920', 'PAGO'],
    ['Clínica Vida', 'R$ 21.300', 'PIX'],
    ['Studio Arq', 'R$ 5.640', 'BOLETO'],
  ];
  rows.forEach((r, i) => {
    const y = 108 + i * 64;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)';
    rr(ctx, 20, y - 34, W - 40, 54, 10);
    ctx.fill();
    label(ctx, r[0], 40, y, { family: F.sans, weight: 700, size: 22, ls: 0, color: '#e8efeb' });
    label(ctx, r[1], 330, y, { size: 20, ls: 0, color: '#cfe0d6' });
    chip(ctx, '✓ ' + r[2], 470, y - 6, { size: 14 });
  });
  return { tex: canvasTexture(c), w: W, h: H };
}

// plano de UI em 3D (material premultiplicado, com wipe/opacity do material de texto)
export function uiPlane(tex, w, h, scale = 0.01) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * scale, h * scale), makeTextMaterial(tex));
  m.material.depthTest = true;
  m.material.depthWrite = false;
  m.frustumCulled = false;
  return m;
}

// ───────────────────────── Serviços ─────────────────────────

// Camadas de um app web "explodido" (para o SISTEMAS WEB)
export function appLayers() {
  const out = [];
  // L0: janela base (barra + sidebar)
  {
    const W = 680, H = 430;
    const { c, ctx } = canvas(W, H);
    card(ctx, W, H, { top: 'rgba(12,18,15,0.96)', bottom: 'rgba(5,8,7,0.96)', radius: 18 });
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    rr(ctx, 3, 3, W - 6, 44, [18, 18, 0, 0]);
    ctx.fill();
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(26 + i * 22, 25, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    rr(ctx, 110, 12, 300, 26, 13);
    ctx.fill();
    label(ctx, 'app.suaempresa.com.br', 126, 30, { size: 13, ls: 0, color: '#8fa699', weight: 500 });
    // sidebar
    ctx.fillStyle = 'rgba(57,255,20,0.06)';
    ctx.fillRect(3, 47, 150, H - 50);
    ['Dashboard', 'Vendas', 'Financeiro', 'Estoque', 'Clientes', 'Relatórios'].forEach((m, i) => {
      const y = 92 + i * 46;
      if (i === 0) {
        ctx.fillStyle = 'rgba(57,255,20,0.16)';
        rr(ctx, 12, y - 24, 132, 36, 8);
        ctx.fill();
      }
      ctx.fillStyle = i === 0 ? C.green : '#5f7568';
      rr(ctx, 24, y - 13, 14, 14, 4);
      ctx.fill();
      label(ctx, m, 48, y, { family: F.sans, weight: 700, size: 15, ls: 0, color: i === 0 ? '#e9ffe2' : '#8fa699' });
    });
    out.push({ tex: canvasTexture(c), w: W, h: H });
  }
  // L1: grade de KPIs
  {
    const W = 500, H = 150;
    const { c, ctx } = canvas(W, H);
    const items = [['VENDAS', '1.284'], ['TICKET', 'R$ 193'], ['NOVOS', '+87']];
    items.forEach(([k, v], i) => {
      const x = i * 168;
      ctx.save();
      ctx.translate(x, 0);
      card(ctx, 158, H, { radius: 14 });
      label(ctx, k, 18, 40, { size: 13, color: '#8fa699' });
      label(ctx, v, 18, 92, { family: F.sans, weight: 800, size: 34, ls: -1, color: '#ffffff' });
      ctx.fillStyle = C.green;
      rr(ctx, 18, 112, 60 + i * 20, 6, 3);
      ctx.fill();
      ctx.restore();
    });
    out.push({ tex: canvasTexture(c), w: W, h: H });
  }
  // L2: gráfico de barras
  {
    const W = 500, H = 220;
    const { c, ctx } = canvas(W, H);
    card(ctx, W, H, { radius: 14 });
    label(ctx, 'FATURAMENTO SEMANAL', 22, 40, { size: 13, color: '#b9cfc2' });
    const v = [0.35, 0.5, 0.42, 0.68, 0.6, 0.82, 0.95];
    v.forEach((h, i) => {
      const x = 30 + i * 64, bh = h * 130;
      const g = ctx.createLinearGradient(0, 196 - bh, 0, 196);
      g.addColorStop(0, C.green);
      g.addColorStop(1, 'rgba(57,255,20,0.15)');
      ctx.fillStyle = g;
      rr(ctx, x, 196 - bh, 40, bh, 6);
      ctx.fill();
    });
    out.push({ tex: canvasTexture(c), w: W, h: H });
  }
  // L3: toast de sucesso
  {
    const W = 330, H = 76;
    const { c, ctx } = canvas(W, H);
    card(ctx, W, H, { radius: 14, border: 'rgba(57,255,20,0.7)', top: 'rgba(16,40,14,0.97)', bottom: 'rgba(8,22,8,0.97)' });
    ctx.fillStyle = C.green;
    ctx.beginPath();
    ctx.arc(36, 38, 16, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, '✓', 36, 45, { family: F.sans, weight: 900, size: 20, color: '#031006', align: 'center', ls: 0 });
    label(ctx, 'Pedido #4821 aprovado', 64, 45, { family: F.sans, weight: 700, size: 18, ls: 0, color: '#eaffe4' });
    out.push({ tex: canvasTexture(c), w: W, h: H });
  }
  return out;
}

// Coluna e cartões do CRM (kanban)
export function kanbanColumn(title, accent = false) {
  const W = 230, H = 470;
  const { c, ctx } = canvas(W, H);
  card(ctx, W, H, { radius: 16, top: 'rgba(12,18,15,0.9)', bottom: 'rgba(5,8,7,0.9)', border: accent ? 'rgba(57,255,20,0.75)' : 'rgba(57,255,20,0.25)' });
  label(ctx, title, 18, 40, { size: 15, color: accent ? C.green : '#b9cfc2' });
  ctx.fillStyle = accent ? 'rgba(57,255,20,0.6)' : 'rgba(255,255,255,0.12)';
  ctx.fillRect(18, 54, W - 36, 2);
  return { tex: canvasTexture(c), w: W, h: H };
}

export function dealCard(name, value, won = false) {
  const W = 200, H = 70;
  const { c, ctx } = canvas(W, H);
  card(ctx, W, H, { radius: 10, border: won ? 'rgba(57,255,20,0.9)' : 'rgba(255,255,255,0.18)', top: won ? 'rgba(20,52,14,0.98)' : 'rgba(26,32,30,0.98)', bottom: won ? 'rgba(10,30,8,0.98)' : 'rgba(16,20,18,0.98)' });
  label(ctx, name, 14, 30, { family: F.sans, weight: 700, size: 16, ls: 0, color: '#f0f5f2' });
  label(ctx, value, 14, 54, { size: 14, ls: 0, color: won ? C.green : '#8fa699' });
  if (won) label(ctx, '✓', W - 30, 44, { family: F.sans, weight: 900, size: 24, ls: 0, color: C.green });
  return { tex: canvasTexture(c), w: W, h: H };
}

// Tela do celular (alta, para rolar) — loja online
export function phoneScreen() {
  const W = 400, H = 1400;
  const { c, ctx } = canvas(W, H, 1.6);
  ctx.fillStyle = '#060908';
  ctx.fillRect(0, 0, W, H);
  // barra de status
  label(ctx, '9:41', 24, 34, { family: F.sans, weight: 700, size: 16, ls: 0, color: '#fff' });
  // header
  label(ctx, 'sualoja', 24, 92, { family: F.sans, weight: 900, size: 30, ls: -1, color: '#fff' });
  ctx.fillStyle = C.green;
  ctx.beginPath();
  ctx.arc(128, 84, 6, 0, Math.PI * 2);
  ctx.fill();
  // hero
  const g = ctx.createLinearGradient(0, 120, 0, 420);
  g.addColorStop(0, 'rgba(57,255,20,0.35)');
  g.addColorStop(1, 'rgba(57,255,20,0.02)');
  ctx.fillStyle = g;
  rr(ctx, 16, 120, W - 32, 300, 22);
  ctx.fill();
  label(ctx, 'NOVA COLEÇÃO', 36, 170, { size: 14, color: C.green });
  label(ctx, 'Tudo que sua', 36, 222, { family: F.sans, weight: 900, size: 36, ls: -1, color: '#fff' });
  label(ctx, 'empresa precisa.', 36, 264, { family: F.sans, weight: 900, size: 36, ls: -1, color: '#fff' });
  ctx.fillStyle = C.green;
  rr(ctx, 36, 320, 170, 54, 27);
  ctx.fill();
  label(ctx, 'COMPRAR', 121, 354, { family: F.sans, weight: 900, size: 18, ls: 1, color: '#031006', align: 'center' });
  // produtos
  for (let i = 0; i < 6; i++) {
    const x = 16 + (i % 2) * ((W - 40) / 2 + 8), y = 450 + Math.floor(i / 2) * 290;
    const w = (W - 40) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    rr(ctx, x, y, w, 270, 18);
    ctx.fill();
    const pg = ctx.createLinearGradient(x, y, x + w, y + 170);
    pg.addColorStop(0, ['#1d3a16', '#2a2f2c', '#0f2a0a'][i % 3]);
    pg.addColorStop(1, '#0a0d0c');
    ctx.fillStyle = pg;
    rr(ctx, x + 10, y + 10, w - 20, 160, 12);
    ctx.fill();
    label(ctx, ['Kit Pro', 'Plano Gold', 'Combo', 'Starter', 'Premium', 'Anual'][i], x + 14, y + 205, { family: F.sans, weight: 800, size: 18, ls: 0, color: '#fff' });
    label(ctx, 'R$ ' + [189, 349, 99, 59, 499, 899][i] + ',90', x + 14, y + 238, { size: 15, ls: 0, color: C.green });
  }
  const tex = canvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { tex, w: W, h: H };
}

export function toast(title, sub, icon = '✓') {
  const W = 360, H = 92;
  const { c, ctx } = canvas(W, H);
  card(ctx, W, H, { radius: 18, border: 'rgba(57,255,20,0.55)', top: 'rgba(18,28,22,0.97)', bottom: 'rgba(8,12,10,0.97)' });
  ctx.fillStyle = 'rgba(57,255,20,0.18)';
  rr(ctx, 16, 18, 56, 56, 14);
  ctx.fill();
  label(ctx, icon, 44, 56, { family: F.sans, weight: 900, size: 26, ls: 0, color: C.green, align: 'center' });
  label(ctx, title, 88, 42, { family: F.sans, weight: 800, size: 20, ls: 0, color: '#ffffff' });
  label(ctx, sub, 88, 70, { size: 15, ls: 0, color: '#8fa699' });
  return { tex: canvasTexture(c), w: W, h: H };
}

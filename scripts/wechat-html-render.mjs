import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), values[index + 1] && !values[index + 1].startsWith('--') ? values[index + 1] : true]);
  return pairs;
}, []));

if (!args.input || !args.output) {
  throw new Error('用法：node wechat-html-render.mjs --input <文章.md> --output <目录> [--style <id>|--preview]');
}

const sans = '-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif';
const serif = 'Georgia,Times New Roman,Songti SC,Noto Serif CJK SC,SimSun,serif';
const mono = 'SFMono-Regular,Consolas,Liberation Mono,Menlo,monospace';

const styles = {
  minimal: {
    label: '极简黑白',
    body: `max-width:740px;margin:0 auto;padding:24px 22px;background-color:#ffffff;`,
    h1: `font-family:${sans};font-size:24px;line-height:1.35;font-weight:800;text-align:left;margin:34px 0 24px;color:#111111;padding-bottom:16px;border-bottom:1px solid #111111;`,
    h2: `font-family:${sans};font-size:19px;line-height:1.45;font-weight:800;margin:42px 0 14px;color:#111111;border-left:3px solid #111111;padding-left:10px;`,
    h3: `font-family:${sans};font-size:17px;line-height:1.5;font-weight:760;margin:30px 0 10px;color:#222222;`,
    p: `font-family:${sans};font-size:16px;line-height:1.82;color:#2b2b2b;margin:12px 0;`,
    quote: `font-family:${sans};font-size:16px;line-height:1.82;color:#555555;margin:20px 0;padding:13px 16px;border-left:3px solid #111111;background-color:#f7f7f7;font-style:normal;`,
    list: `font-family:${sans};font-size:16px;line-height:1.82;color:#2b2b2b;margin:12px 0;padding-left:20px;`,
    li: `font-family:${sans};font-size:16px;line-height:1.82;color:#2b2b2b;margin:7px 0;`,
    strong: 'font-weight:850;color:#111111;',
    code: `font-family:${mono};background-color:#f2f2f2;color:#111111;padding:2px 6px;border-radius:3px;font-size:14px;`,
    hr: 'border:none;border-top:1px solid #e0e0e0;margin:32px 0;',
  },
  medium: {
    label: 'Medium Essay',
    body: 'max-width:680px;margin:0 auto;padding:34px 24px;background-color:#ffffff;',
    h1: `font-family:${serif};font-size:28px;line-height:1.28;font-weight:700;text-align:left;margin:42px 0 28px;color:#111111;`,
    h2: `font-family:${serif};font-size:22px;line-height:1.35;font-weight:700;margin:52px 0 18px;color:#111111;`,
    h3: `font-family:${serif};font-size:18px;line-height:1.45;font-weight:700;margin:34px 0 12px;color:#333333;`,
    p: `font-family:${serif};font-size:16px;line-height:1.92;color:#242424;margin:15px 0;`,
    quote: `font-family:${serif};font-size:17px;line-height:1.86;color:#444444;margin:28px 0;padding:0 0 0 22px;border-left:3px solid #242424;font-style:italic;`,
    list: `font-family:${serif};font-size:16px;line-height:1.9;color:#242424;margin:15px 0;padding-left:24px;`,
    li: `font-family:${serif};font-size:16px;line-height:1.9;color:#242424;margin:8px 0;`,
    strong: 'font-weight:800;color:#111111;',
    code: `font-family:${mono};background-color:#f2f2f2;color:#222222;padding:2px 6px;border-radius:3px;font-size:14px;`,
    hr: 'border:none;border-top:1px solid #d8d8d8;margin:40px auto;width:34%;',
  },
  stripe: {
    label: 'Stripe Docs',
    body: 'max-width:760px;margin:0 auto;padding:24px 22px;background-color:#fbfcff;',
    h1: `font-family:${sans};font-size:25px;line-height:1.32;font-weight:850;text-align:left;margin:36px 0 24px;color:#0a2540;`,
    h2: `font-family:${sans};font-size:19px;line-height:1.45;font-weight:820;margin:42px 0 14px;color:#0a2540;padding:10px 12px;background-color:#f1f5ff;border-left:4px solid #635bff;`,
    h3: `font-family:${sans};font-size:17px;line-height:1.5;font-weight:780;margin:30px 0 10px;color:#425466;`,
    p: `font-family:${sans};font-size:16px;line-height:1.78;color:#2a2f45;margin:12px 0;`,
    quote: `font-family:${sans};font-size:16px;line-height:1.78;color:#3c4257;margin:20px 0;padding:14px 16px;background-color:#ffffff;border:1px solid #d9e2f3;border-left:4px solid #635bff;font-style:normal;`,
    list: `font-family:${sans};font-size:16px;line-height:1.76;color:#2a2f45;margin:12px 0;padding-left:0;list-style:none;`,
    li: `font-family:${sans};font-size:16px;line-height:1.76;color:#2a2f45;margin:8px 0;padding:9px 10px;background-color:#ffffff;border:1px solid #e5ebf5;`,
    strong: 'font-weight:850;color:#0a2540;',
    code: `font-family:${mono};background-color:#eef2ff;color:#3b35a8;padding:2px 6px;border-radius:4px;font-size:14px;`,
    hr: 'border:none;border-top:1px solid #d9e2f3;margin:32px 0;',
  },
  wired: {
    label: 'WIRED Feature',
    body: 'max-width:750px;margin:0 auto;padding:22px;background-color:#ffffff;',
    h1: `font-family:${sans};font-size:28px;line-height:1.16;font-weight:950;text-align:left;margin:36px 0 26px;color:#111111;border-top:6px solid #111111;border-bottom:6px solid #111111;padding:16px 0;`,
    h2: `font-family:${sans};font-size:20px;line-height:1.35;font-weight:950;margin:44px 0 14px;color:#111111;background-color:#f5ff00;padding:10px 12px;`,
    h3: `font-family:${sans};font-size:18px;line-height:1.4;font-weight:900;margin:32px 0 10px;color:#111111;border-bottom:4px solid #00e5ff;padding-bottom:5px;`,
    p: `font-family:${sans};font-size:16px;line-height:1.74;color:#111111;margin:12px 0;`,
    quote: `font-family:${sans};font-size:16px;line-height:1.74;color:#ffffff;margin:22px 0;padding:15px 16px;background-color:#111111;border-left:0;font-weight:750;font-style:normal;`,
    list: `font-family:${sans};font-size:16px;line-height:1.72;color:#111111;margin:12px 0;padding-left:0;list-style:none;`,
    li: `font-family:${sans};font-size:16px;line-height:1.72;color:#111111;margin:8px 0;padding:8px 10px;background-color:#f2f2f2;border-left:5px solid #111111;`,
    strong: 'font-weight:950;color:#111111;background-color:#f5ff00;',
    code: `font-family:${mono};background-color:#111111;color:#00e5ff;padding:2px 6px;font-size:14px;`,
    hr: 'border:none;height:5px;background-color:#111111;margin:34px 0;',
  },
  ft: {
    label: 'FT Analysis',
    body: 'max-width:740px;margin:0 auto;padding:24px 22px;background-color:#fff1df;',
    h1: `font-family:${serif};font-size:27px;line-height:1.3;font-weight:800;text-align:left;margin:38px 0 24px;color:#111111;border-bottom:3px double #5a4a36;padding-bottom:14px;`,
    h2: `font-family:${serif};font-size:21px;line-height:1.42;font-weight:800;margin:46px 0 16px;color:#3b2b1d;padding-top:10px;border-top:1px solid #8a7356;`,
    h3: `font-family:${serif};font-size:18px;line-height:1.5;font-weight:750;margin:32px 0 10px;color:#4c3a29;`,
    p: `font-family:${serif};font-size:16px;line-height:1.9;color:#262018;margin:13px 0;`,
    quote: `font-family:${serif};font-size:16px;line-height:1.9;color:#4f4030;margin:22px 0;padding:12px 0 12px 18px;border-left:4px solid #8a7356;background-color:#f9e6cf;font-style:normal;`,
    list: `font-family:${serif};font-size:16px;line-height:1.9;color:#262018;margin:13px 0;padding-left:22px;`,
    li: `font-family:${serif};font-size:16px;line-height:1.9;color:#262018;margin:7px 0;`,
    strong: 'font-weight:850;color:#111111;',
    code: `font-family:${mono};background-color:#f5dec4;color:#3b2b1d;padding:2px 6px;border-radius:2px;font-size:14px;`,
    hr: 'border:none;border-top:1px solid #8a7356;margin:34px 0;width:58%;',
  },
  course: {
    label: '课程讲义',
    body: 'max-width:750px;margin:0 auto;padding:22px;background-color:#ffffff;',
    h1: `font-family:${sans};font-size:24px;line-height:1.38;font-weight:800;text-align:center;margin:34px 0 22px;color:#111111;`,
    h2: `font-family:${sans};font-size:19px;line-height:1.45;font-weight:800;margin:40px 0 16px;color:#111111;padding:11px 14px;background-color:#f3f3f3;`,
    h3: `font-family:${sans};font-size:17px;line-height:1.5;font-weight:800;margin:30px 0 10px;color:#111111;padding-bottom:6px;border-bottom:1px dotted #aaaaaa;`,
    p: `font-family:${sans};font-size:16px;line-height:1.84;color:#272727;margin:12px 0;`,
    quote: `font-family:${sans};font-size:16px;line-height:1.84;color:#444444;margin:18px 0;padding:14px 16px;background-color:#f8f8f8;border-top:1px solid #e1e1e1;border-bottom:1px solid #e1e1e1;font-style:normal;`,
    list: `font-family:${sans};font-size:16px;line-height:1.84;color:#272727;margin:12px 0;padding-left:20px;`,
    li: `font-family:${sans};font-size:16px;line-height:1.84;color:#272727;margin:7px 0;`,
    strong: 'font-weight:850;color:#111111;',
    code: `font-family:${mono};background-color:#eeeeee;color:#222222;padding:2px 6px;border-radius:3px;font-size:14px;`,
    hr: 'border:none;border-top:1px solid #dddddd;margin:30px 0;',
  },
};

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function inline(value, style) {
  return escapeHtml(value.replace(/。$/u, ''))
    .replace(/\*\*(.+?)\*\*/gu, `<strong style="${style.strong}">$1</strong>`)
    .replace(/`(.+?)`/gu, `<code style="${style.code}">$1</code>`)
    .replace(/\[(.+?)\]\((.+?)\)/gu, '$1');
}

function render(markdown, styleId, title) {
  const style = styles[styleId];
  if (!style) throw new Error(`未知风格：${styleId}`);
  const out = [
    '<!doctype html>', '<html lang="zh-CN">',
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>`,
    `<body style="${style.body}">`,
  ];
  let list = null;
  const closeList = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const text = raw.trim();
    if (!text) { closeList(); continue; }
    if (/^---+$/u.test(text)) { closeList(); out.push(`<hr style="${style.hr}">`); continue; }
    const heading = text.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) { closeList(); const level = heading[1].length; out.push(`<h${level} style="${style[`h${level}`]}">${inline(heading[2], style)}</h${level}>`); continue; }
    const quote = text.match(/^>\s*(.+)$/u);
    if (quote) { closeList(); out.push(`<blockquote style="${style.quote}">${inline(quote[1], style)}</blockquote>`); continue; }
    const image = text.match(/^!\[(.*?)\]\((.*?)\)$/u);
    if (image) { closeList(); out.push(`<p style="${style.p}">[图片：${inline(image[1] || '待补充', style)}]</p>`); continue; }
    const bullet = text.match(/^[-*]\s+(.+)$/u);
    const ordered = text.match(/^\d+[.)]\s+(.+)$/u);
    if (bullet || ordered) {
      const desired = ordered ? 'ol' : 'ul';
      if (list !== desired) { closeList(); list = desired; out.push(`<${list} style="${style.list}">`); }
      out.push(`<li style="${style.li}">${inline((bullet || ordered)[1], style)}</li>`);
      continue;
    }
    closeList();
    out.push(`<p style="${style.p}">${inline(text, style)}</p>`);
  }
  closeList();
  out.push('</body>', '</html>');
  return `${out.join('\n')}\n`;
}

function formalCheck(html) {
  const forbidden = /<style|class=|id=|:before|:after|<script|https?:\/\/|@import|<main/iu;
  if (forbidden.test(html)) throw new Error('正式 HTML 含微信公众号不稳定标记');
  const elements = [...html.matchAll(/<(p|h1|h2|h3|blockquote|ul|ol|li)(?:\s[^>]*)?>/giu)];
  if (elements.some((match) => !/\sstyle=/iu.test(match[0]))) throw new Error('存在未写行内样式的可见元素');
}

const markdown = readFileSync(resolve(args.input), 'utf8');
const output = resolve(args.output);
mkdirSync(output, {recursive: true});
const base = basename(args.input, '.md');
const ids = args.preview ? ['minimal', 'medium', 'stripe', 'wired', 'ft', 'course'] : [args.style || 'medium'];
const pages = ids.map((id) => {
  const file = ids.length === 1 && typeof args.name === 'string'
    ? args.name
    : `${base}_${id}_${styles[id].label}_微信公众号版.html`;
  const html = render(markdown, id, base);
  formalCheck(html);
  writeFileSync(join(output, file), html, 'utf8');
  return {id, file, label: styles[id].label};
});

if (args.preview) {
  const cards = pages.map(({id, file, label}) => `<li><a href="${file}">${label}（${id}）</a></li>`).join('');
  writeFileSync(join(output, '00_公众号HTML风格总览.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>公众号 HTML 风格总览</title><style>body{max-width:720px;margin:40px auto;padding:0 20px;font-family:system-ui,sans-serif;color:#222}li{margin:14px 0}a{color:#0b57d0;text-decoration:none}</style></head><body><h1>公众号 HTML 风格总览</h1><p>以下页面均为可复制到微信公众号后台的行内样式版本。</p><ul>${cards}</ul></body></html>`, 'utf8');
}

console.log(JSON.stringify({output, pages}, null, 2));

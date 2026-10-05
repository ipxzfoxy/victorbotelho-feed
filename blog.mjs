#!/usr/bin/env node

import { promises as fs, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(ROOT, 'content', 'posts');
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMAGES_DIR = path.join(ROOT, 'images');
const DIST_DIR = path.join(ROOT, 'dist');
const INDEX_TEMPLATE = path.join(ROOT, 'src', 'index.template.html');
const CONFIG_PATH = path.join(ROOT, 'site.config.json');

const SOCIAL_TAGS = new Set(['linkedin', 'x']);
const CATEGORY_LABELS = {
  dev: 'Programação',
  projects: 'Projetos',
  ideas: 'Ideias'
};

function normalizeRootPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value = '') {
  return escapeHtml(value);
}

function unquote(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return v;
}

function parseScalar(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^(null|~)$/i.test(raw)) return null;
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map(item => unquote(item.trim())).filter(Boolean);
  }
  return unquote(raw);
}

function splitFrontMatter(source) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('O post precisa começar com front matter: ---');
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('Front matter sem fechamento ---');
  return {
    frontMatter: normalized.slice(4, end),
    body: normalized.slice(end + 5).replace(/^\n+/, '')
  };
}

function parseFrontMatter(text) {
  const lines = text.split('\n');
  const data = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const top = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!top) continue;

    const key = top[1];
    const value = top[2] ?? '';
    if (value.trim()) {
      data[key] = parseScalar(value);
      continue;
    }

    const block = [];
    let j = i + 1;
    while (j < lines.length && (/^\s+/.test(lines[j]) || !lines[j].trim())) {
      block.push(lines[j]);
      j++;
    }
    i = j - 1;

    if (key === 'buttons') {
      const buttons = [];
      let current = null;
      for (const blockLine of block) {
        const item = blockLine.match(/^\s*-\s*label:\s*(.*)$/);
        if (item) {
          if (current) buttons.push(current);
          current = { label: unquote(item[1]), link: '' };
          continue;
        }
        const link = blockLine.match(/^\s+link:\s*(.*)$/);
        if (link && current) current.link = unquote(link[1]);
      }
      if (current) buttons.push(current);
      data[key] = buttons.filter(button => button.label && button.link);
      continue;
    }

    const list = block
      .map(blockLine => blockLine.match(/^\s*-\s*(.*)$/)?.[1])
      .filter(value => value !== undefined)
      .map(parseScalar)
      .filter(value => value !== '' && value !== null);
    data[key] = list;
  }

  return data;
}

function quoteYaml(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';
}

function validId(value) {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function formatDate(date) {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(date || '');
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

function xmlEscape(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function inlineMarkdown(text) {
  const tokens = [];
  let value = String(text);

  value = value.replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${tokens.length}\u0000`;
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  value = escapeHtml(value);

  value = value
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+|\/[^)]+|\.\.?\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  value = value.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
  return value;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  let listType = null;
  let listItems = [];
  let rawHtml = [];
  let rawTag = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inlineMarkdown(paragraph.join(' ').trim())}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length || !listType) return;
    const tag = listType === 'ol' ? 'ol' : 'ul';
    out.push(`<${tag}>${listItems.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</${tag}>`);
    listItems = [];
    listType = null;
  };

  const flushRaw = () => {
    if (!rawHtml.length) return;
    out.push(rawHtml.join('\n'));
    rawHtml = [];
    rawTag = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inCode) {
      if (/^```/.test(line)) {
        const cls = codeLang ? ` class="language-${escapeAttr(codeLang)}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
        codeLang = '';
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (rawTag) {
      rawHtml.push(line);
      if (new RegExp(`</${rawTag}>`, 'i').test(line)) flushRaw();
      continue;
    }

    const fence = line.match(/^```\s*([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      inCode = true;
      codeLang = fence[1] || '';
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    // Trusted author HTML is intentionally preserved.
    const rawStart = line.match(/^\s*<([A-Za-z][A-Za-z0-9-]*)(?:\s|>|\/)/);
    if (rawStart) {
      flushParagraph();
      flushList();
      const tag = rawStart[1];
      if (line.includes(`</${tag}>`) || /\/>\s*$/.test(line) || /^(?:\s*)<(?:hr|br|img|input|meta|link)\b/i.test(line)) {
        out.push(line);
      } else {
        rawTag = tag;
        rawHtml.push(line);
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text.replace(/[*_`~]/g, ''));
      out.push(`<h${level} id="${escapeAttr(id)}">${inlineMarkdown(text)}</h${level}>`);
      continue;
    }

    if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
      flushParagraph();
      flushList();
      out.push('<hr>');
      continue;
    }

    const blockquote = line.match(/^>\s?(.*)$/);
    if (blockquote) {
      flushParagraph();
      flushList();
      const quoteLines = [blockquote[1]];
      while (i + 1 < lines.length) {
        const next = lines[i + 1].match(/^>\s?(.*)$/);
        if (!next) break;
        quoteLines.push(next[1]);
        i++;
      }
      out.push(`<blockquote>${quoteLines.map(q => `<p>${inlineMarkdown(q)}</p>`).join('')}</blockquote>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(ordered[1]);
      continue;
    }

    if (listType) flushList();
    paragraph.push(line.trim());
  }

  if (inCode) {
    const cls = codeLang ? ` class="language-${escapeAttr(codeLang)}"` : '';
    out.push(`<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  flushParagraph();
  flushList();
  flushRaw();
  return out.join('\n');
}

function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeDescription(meta, body) {
  const preferred = String(meta.description || '').trim();
  if (preferred) return preferred.slice(0, 220);
  const plain = stripMarkdown(body);
  return plain.length > 180 ? `${plain.slice(0, 177).trim()}...` : plain;
}

function makeExcerpt(body, maxLength = 180) {
  const plain = stripMarkdown(body);
  if (!plain) return '';
  if (plain.length <= maxLength) return plain;
  const clipped = plain.slice(0, maxLength - 3);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.65 ? clipped.slice(0, lastSpace) : clipped).trim()}...`;
}

function parseAuthorSpec(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const name = String(value.name || value.handle || '').trim();
    const link = String(value.link || '').trim();
    return name ? { name, link: link || null } : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Sintaxe simples: "@autor(https://link)" ou apenas "@autor".
  const match = raw.match(/^(.+?)\((https?:\/\/[^)]+)\)$/i);
  if (match) return { name: match[1].trim(), link: match[2].trim() };
  return { name: raw, link: null };
}

function absoluteUrl(base, target) {
  if (!target) return null;
  if (/^https?:\/\//i.test(target)) return target;
  return new URL(target.startsWith('/') ? target : `/${target}`, `${base.replace(/\/$/, '')}/`).href;
}

function normalizeBanner(value) {
  if (value === null || value === undefined || value === '') return null;
  const v = String(value).trim();
  if (!v || /^null$/i.test(v) || v === '-') return null;
  return v.startsWith('/') || /^https?:\/\//i.test(v) ? v : `/${v.replace(/^\.\//, '')}`;
}

async function loadConfig() {
  return JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
}

async function listMarkdownFiles() {
  await fs.mkdir(CONTENT_DIR, { recursive: true });
  const entries = await fs.readdir(CONTENT_DIR, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md')).map(entry => path.join(CONTENT_DIR, entry.name));
}

async function loadPosts({ includeDrafts = false } = {}) {
  const files = await listMarkdownFiles();
  const seenIds = new Map();
  const posts = [];

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const { frontMatter, body } = splitFrontMatter(source);
    const meta = parseFrontMatter(frontMatter);

    const id = String(meta.id || path.basename(file, '.md')).trim();
    if (!validId(id)) throw new Error(`ID inválido em ${path.basename(file)}: ${id}`);
    if (seenIds.has(id)) throw new Error(`ID duplicado "${id}" em ${path.basename(file)} e ${path.basename(seenIds.get(id))}`);
    seenIds.set(id, file);

    const title = String(meta.title || '').trim();
    if (!title) throw new Error(`Post ${id} sem title.`);

    const draft = meta.draft === true;
    if (draft && !includeDrafts) continue;

    const badges = Array.isArray(meta.badges) ? meta.badges.map(String) : [];
    const tags = Array.isArray(meta.tags) ? meta.tags.map(value => String(value).toLowerCase()) : [];
    const buttons = Array.isArray(meta.buttons) ? meta.buttons : [];
    const rawAuthors = Array.isArray(meta.authors) ? meta.authors : (meta.authors ? [meta.authors] : []);
    const authors = rawAuthors.map(parseAuthorSpec).filter(Boolean);
    const description = makeDescription(meta, body);

    posts.push({
      file,
      source,
      frontMatter,
      body,
      html: renderMarkdown(body),
      id,
      title,
      description,
      excerpt: makeExcerpt(body),
      date: String(meta.date || new Date().toISOString().slice(0, 10)),
      category: String(meta.category || 'ideas'),
      banner: normalizeBanner(meta.banner),
      featured: meta.featured === true,
      draft,
      badges,
      tags,
      buttons,
      authors,
      socialTags: tags.filter(tag => SOCIAL_TAGS.has(tag)),
      searchTags: tags.filter(tag => !SOCIAL_TAGS.has(tag))
    });
  }

  return posts.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'pt-BR'));
}

function socialOrigins(post) {
  if (!post.socialTags.length) return '';
  const labels = { linkedin: 'Publicado no LinkedIn', x: 'Publicado no X' };
  return `<div class="social-origins">${post.socialTags.map(tag => `<span class="social-origin">${escapeHtml(labels[tag] || tag)}</span>`).join('')}</div>`;
}

function badgesHtml(post) {
  if (!post.badges.length) return '';
  return `<div class="card-badges">${post.badges.map(badge => `<span class="mini-badge">${escapeHtml(badge)}</span>`).join('')}</div>`;
}

function authorsHtml(post, variant = 'card') {
  if (!post.authors?.length) return '';
  const links = post.authors.map(author => {
    const name = escapeHtml(author.name);
    if (!author.link) return `<span class="author-name">${name}</span>`;
    return `<a class="author-link" href="${escapeAttr(author.link)}" target="_blank" rel="noreferrer">${name}</a>`;
  }).join('<span class="author-separator">·</span>');
  return `<div class="authors authors-${escapeAttr(variant)}"><span class="authors-label">Por</span>${links}</div>`;
}

function postHref(config, post) {
  const base = String(config.postsPath || '/posts').replace(/\/$/, '');
  return `${base}/${post.id}/`;
}

function featuredHtml(config, post) {
  if (!post) return '';
  const href = postHref(config, post);
  const visual = post.banner
    ? `<div class="featured-visual"><img class="featured-banner" src="${escapeAttr(post.banner)}" alt="Banner de ${escapeAttr(post.title)}"></div>`
    : '';
  const category = CATEGORY_LABELS[post.category] || post.category;
  return `
    <article class="featured${post.banner ? '' : ' no-banner'}">
      ${visual}
      <div class="featured-content">
        <span class="tag">Destaque · ${escapeHtml(category)}</span>
        <h2>${escapeHtml(post.title)}</h2>
        <p class="featured-description">${escapeHtml(post.description)}</p>
        ${post.excerpt ? `<p class="featured-excerpt">${escapeHtml(post.excerpt)}</p>` : ''}
        ${authorsHtml(post, 'featured')}
        ${authorsHtml(post, 'post')}
        ${badgesHtml(post)}
        ${socialOrigins(post)}
        <div class="meta">
          <span>${escapeHtml(formatDate(post.date))}</span>
          <span>•</span>
          <span>${Math.max(1, Math.ceil(stripMarkdown(post.body).split(/\s+/).filter(Boolean).length / 220))} min de leitura</span>
        </div>
        <a class="read-more" href="${escapeAttr(href)}">Ler post →</a>
      </div>
    </article>`;
}

function cardHtml(config, post) {
  const category = CATEGORY_LABELS[post.category] || post.category;
  const search = [post.title, post.description, post.excerpt, category, ...post.badges, ...post.tags, ...post.authors.map(author => author.name)].join(' ').toLowerCase();
  const bannerImage = post.banner
    ? `<img class="card-banner" src="${escapeAttr(post.banner)}" alt="Banner de ${escapeAttr(post.title)}" loading="lazy">`
    : '';
  const icon = post.banner ? '' : `<div class="icon">${escapeHtml(post.title.trim().charAt(0).toUpperCase())}</div>`;

  const href = postHref(config, post);
  return `
        <article class="card${post.banner ? ' has-banner' : ' no-banner'}" data-category="${escapeAttr(post.category)}" data-search="${escapeAttr(search)}">
          ${post.banner ? `<a class="card-visual" href="${escapeAttr(href)}" aria-label="Abrir ${escapeAttr(post.title)}">${bannerImage}</a>` : ''}
          <div class="card-content">
            ${icon}
            ${badgesHtml(post)}
            <h4><a href="${escapeAttr(href)}">${escapeHtml(post.title)}</a></h4>
            <p class="card-description">${escapeHtml(post.description)}</p>
            ${post.excerpt ? `<p class="card-excerpt">${escapeHtml(post.excerpt)}</p>` : ''}
            ${authorsHtml(post, 'card')}
            ${socialOrigins(post)}
            <div class="meta">
              <span>${escapeHtml(category)}</span>
              <span>•</span>
              <span>${escapeHtml(formatDate(post.date))}</span>
            </div>
            <a class="card-read-more" href="${escapeAttr(href)}">Ler post →</a>
          </div>
        </article>`;
}

function postButtons(post) {
  if (!post.buttons.length) return '';
  return `<div class="post-actions">${post.buttons.map(button => `<a class="post-button" href="${escapeAttr(button.link)}"${/^https?:\/\//i.test(button.link) ? ' target="_blank" rel="noreferrer"' : ''}>${escapeHtml(button.label)} ↗</a>`).join('')}</div>`;
}

function postPage(config, post) {
  const canonical = `${config.siteUrl.replace(/\/$/, '')}${postHref(config, post)}`;
  const bannerAbsolute = post.banner ? absoluteUrl(config.siteUrl, post.banner) : null;
  const category = CATEGORY_LABELS[post.category] || post.category;
  const tags = post.searchTags.join(', ');
  const structuredAuthors = post.authors.length
    ? post.authors.map(author => ({
        '@type': 'Person',
        name: author.name,
        ...(author.link ? { url: author.link } : {})
      }))
    : [{ '@type': 'Person', name: config.author, url: 'https://victorbotelho.com.br/' }];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    mainEntityOfPage: canonical,
    author: structuredAuthors.length === 1 ? structuredAuthors[0] : structuredAuthors,
    publisher: { '@type': 'Person', name: config.author },
    ...(bannerAbsolute ? { image: [bannerAbsolute] } : {}),
    ...(post.searchTags.length ? { keywords: post.searchTags.join(', ') } : {})
  };

  return `<!doctype html>
<html lang="${escapeAttr(config.language || 'pt-BR')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(post.title)} — Victor Botelho Anunciação</title>
  <meta name="description" content="${escapeAttr(post.description)}">
  ${tags ? `<meta name="keywords" content="${escapeAttr(tags)}">` : ''}
  <meta name="author" content="${escapeAttr(post.authors.length ? post.authors.map(author => author.name).join(', ') : config.author)}">
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeAttr(post.title)}">
  <meta property="og:description" content="${escapeAttr(post.description)}">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  ${bannerAbsolute ? `<meta property="og:image" content="${escapeAttr(bannerAbsolute)}">` : ''}
  <meta name="twitter:card" content="${bannerAbsolute ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeAttr(post.title)}">
  <meta name="twitter:description" content="${escapeAttr(post.description)}">
  ${bannerAbsolute ? `<meta name="twitter:image" content="${escapeAttr(bannerAbsolute)}">` : ''}
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replaceAll('<', '\\u003c')}</script>
  <style>${POST_CSS}</style>
</head>
<body>
  <header>
    <div class="page nav">
      <a class="brand" href="/">
        <span class="brand-mark">VB</span>
        <span class="brand-title">Victor Botelho Anunciação <span class="brand-path">&gt; Feed</span></span>
      </a>
      <nav class="nav-links">
        <a href="https://victorbotelho.com.br/">Início</a>
        <a class="active" href="/">Feed</a>
        <a class="nav-cta" href="https://victorbotelho.com.br/portfolio">Portfólio ↗</a>
      </nav>
    </div>
  </header>

  <main class="post-page">
    <a class="back" href="/">← Voltar para o Feed</a>
    <article>
      <header class="post-header">
        <span class="tag">${escapeHtml(category)}</span>
        <h1>${escapeHtml(post.title)}</h1>
        <p class="post-description">${escapeHtml(post.description)}</p>
        ${authorsHtml(post, 'post')}
        ${badgesHtml(post)}
        ${socialOrigins(post)}
        <div class="meta"><span>${escapeHtml(formatDate(post.date))}</span><span>•</span><span>${Math.max(1, Math.ceil(stripMarkdown(post.body).split(/\s+/).filter(Boolean).length / 220))} min de leitura</span></div>
      </header>
      ${post.banner ? `<img class="post-banner" src="${escapeAttr(post.banner)}" alt="Banner de ${escapeAttr(post.title)}">` : ''}
      <div class="post-content">${post.html}</div>
      ${postButtons(post)}
    </article>
  </main>

  <footer class="page site-footer">
    <div class="footer-main">
      <strong>Victor Botelho Anunciação</strong>
      <span>Aprendendo, e criando todos os dias. ☕</span>
    </div>
    <div class="footer-meta">
      <a href="/feed.xml">RSS Feed</a>
      <span>© 2026</span>
    </div>
  </footer>
</body>
</html>`;
}

const POST_CSS = String.raw`
:root{--bg:#f6faff;--surface:#fff;--text:#10213a;--muted:#66758d;--blue:#2f80ed;--blue-strong:#1769d2;--blue-dark:#0f4fa8;--line:#dbe9f8;--chip:#eaf4ff;--shadow:0 18px 50px rgba(47,128,237,.10)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--text);background:radial-gradient(circle at 15% 0%,rgba(86,169,255,.16),transparent 30rem),radial-gradient(circle at 90% 10%,rgba(42,115,246,.10),transparent 28rem),var(--bg);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}a{color:inherit;text-decoration:none}.page{width:min(1160px,calc(100% - 36px));margin:0 auto}body>header{position:sticky;top:0;z-index:50;backdrop-filter:blur(18px);background:rgba(246,250,255,.78);border-bottom:1px solid rgba(219,233,248,.75)}.nav{min-height:74px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{display:flex;align-items:center;gap:12px;font-weight:800;letter-spacing:-.02em}.brand-mark{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;color:#fff;background:linear-gradient(135deg,#57a9ff,#1f6fe5);box-shadow:0 8px 22px rgba(47,128,237,.28);font-family:"Space Grotesk",sans-serif}.brand-title{font-weight:800}.brand-path{color:var(--muted);font-weight:600}.nav-links{display:flex;align-items:center;gap:8px}.nav-links a{color:var(--muted);padding:10px 13px;border-radius:12px;font-size:14px;font-weight:600}.nav-links a.active{color:var(--blue-strong);background:var(--chip)}.nav-cta{color:#fff!important;background:var(--blue);box-shadow:0 8px 18px rgba(47,128,237,.2)}.post-page{width:min(820px,calc(100% - 32px));margin:0 auto;padding:58px 0 40px}.back{display:inline-flex;margin-bottom:34px;color:var(--blue-strong);font-weight:800}.post-header{text-align:left}.tag{display:inline-flex;padding:7px 10px;border-radius:999px;background:var(--chip);color:var(--blue-dark);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.post-header h1{font-family:"Space Grotesk",sans-serif;font-size:clamp(40px,7vw,68px);line-height:1.02;letter-spacing:-.05em;margin:20px 0 16px}.post-description{color:var(--muted);font-size:18px;line-height:1.7;margin:0 0 20px}.meta{display:flex;gap:10px;flex-wrap:wrap;color:#8493a7;font-size:13px;margin-top:20px}.card-badges{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0 0}.mini-badge{display:inline-flex;padding:5px 8px;border-radius:999px;background:var(--chip);color:var(--blue-dark);font-size:11px;font-weight:800}.social-origins{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.social-origin{display:inline-flex;color:var(--blue-strong);font-size:12px;font-weight:800}.authors{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.authors-label{color:#8493a7}.authors-post{margin:18px 0 2px;font-size:15px}.authors-post .author-link,.authors-post .author-name{font-weight:800;color:var(--blue-strong);padding:6px 10px;border-radius:999px;background:var(--chip)}.author-separator{color:#afbac8}.post-banner{width:100%;max-height:470px;object-fit:cover;border-radius:24px;border:1px solid var(--line);box-shadow:var(--shadow);margin:38px 0 12px}.post-content{margin-top:46px;font-size:17px;line-height:1.82}.post-content h1,.post-content h2,.post-content h3,.post-content h4,.post-content h5,.post-content h6{font-family:"Space Grotesk",sans-serif;letter-spacing:-.03em;line-height:1.18;scroll-margin-top:100px}.post-content h1{font-size:38px;margin:58px 0 18px}.post-content h2{font-size:31px;margin:50px 0 16px}.post-content h3{font-size:25px;margin:42px 0 14px}.post-content p{margin:0 0 22px}.post-content a{color:var(--blue-strong);text-decoration:underline;text-decoration-color:#9ec8ff;text-underline-offset:3px}.post-content strong{font-weight:800}.post-content blockquote{margin:30px 0;padding:16px 20px;border-left:4px solid var(--blue);background:rgba(234,244,255,.72);border-radius:0 14px 14px 0;color:#35516f}.post-content blockquote p:last-child{margin-bottom:0}.post-content pre{overflow:auto;padding:20px;border-radius:18px;background:#10213a;color:#eaf4ff;border:1px solid rgba(255,255,255,.08);box-shadow:0 14px 36px rgba(16,33,58,.12);font-size:14px;line-height:1.65}.post-content code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.post-content :not(pre)>code{padding:2px 6px;border-radius:7px;background:#eaf4ff;color:#174f8f;font-size:.92em}.post-content ul,.post-content ol{padding-left:26px;margin:0 0 24px}.post-content li{margin:7px 0}.post-content hr{border:0;border-top:1px solid var(--line);margin:42px 0}.post-content img{max-width:100%;height:auto;border-radius:16px}.post-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:44px;padding-top:28px;border-top:1px solid var(--line)}.post-button{display:inline-flex;align-items:center;justify-content:center;padding:12px 15px;border-radius:13px;background:var(--blue);color:#fff;font-weight:800;box-shadow:0 8px 20px rgba(47,128,237,.18);transition:.2s ease}.post-button:hover{transform:translateY(-2px);background:var(--blue-strong)}.site-footer{padding:58px 0 66px;margin-top:56px;color:#8190a4;font-size:14px;display:flex;justify-content:space-between;align-items:flex-end;gap:28px;flex-wrap:wrap}.footer-main{display:flex;flex-direction:column;gap:8px}.footer-main strong{color:var(--text);font-family:"Space Grotesk",sans-serif;font-size:18px}.footer-main span{font-size:15px}.footer-meta{display:flex;align-items:center;gap:16px}.footer-meta a{color:var(--blue-strong);font-weight:800}@media(max-width:640px){.page{width:min(100% - 24px,1160px)}.nav-links a:not(.nav-cta):not(.active){display:none}.nav{min-height:66px}.post-page{padding-top:38px}.post-header h1{font-size:42px}.post-content{font-size:16px}}
`;

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateBanners(posts) {
  for (const post of posts) {
    if (!post.banner || /^https?:\/\//i.test(post.banner)) continue;

    const relative = post.banner.replace(/^\/+/, '');
    const rootAsset = path.join(ROOT, relative);
    const publicAsset = path.join(PUBLIC_DIR, relative);

    if (await fileExists(rootAsset) || await fileExists(publicAsset)) continue;

    console.warn(`⚠ Banner não encontrado para "${post.id}": ${relative}`);
    console.warn(`  Coloque o arquivo em ${normalizeRootPath(path.relative(ROOT, rootAsset))} ou ${normalizeRootPath(path.relative(ROOT, publicAsset))}.`);
    post.banner = null;
  }
}

async function copyDir(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(source, entry.name);
    const dest = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else if (entry.isFile()) await fs.copyFile(src, dest);
  }
}

async function build() {
  const config = await loadConfig();
  const posts = await loadPosts();
  await validateBanners(posts);

  const featuredPosts = posts.filter(post => post.featured);
  if (featuredPosts.length > 1) {
    throw new Error(`Há ${featuredPosts.length} posts marcados como featured. Use "node blog.mjs emp <id>" para corrigir.`);
  }
  const featured = featuredPosts[0] || null;

  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_DIR, { recursive: true });
  if (await fileExists(PUBLIC_DIR)) await copyDir(PUBLIC_DIR, DIST_DIR);
  if (await fileExists(IMAGES_DIR)) await copyDir(IMAGES_DIR, path.join(DIST_DIR, 'images'));

  await fs.writeFile(path.join(DIST_DIR, '.nojekyll'), '', 'utf8');
  try {
    const hostname = new URL(config.siteUrl).hostname;
    if (hostname && !hostname.endsWith('.github.io')) {
      await fs.writeFile(path.join(DIST_DIR, 'CNAME'), `${hostname}\n`, 'utf8');
    }
  } catch {
    // siteUrl inválida: o restante do build ainda pode continuar.
  }

  let index = await fs.readFile(INDEX_TEMPLATE, 'utf8');
  const cards = posts.length
    ? posts.map(post => cardHtml(config, post)).join('\n')
    : '<div class="empty-posts">Ainda não tem post publicado por aqui.</div>';
  index = index.replace('{{FEATURED_POST}}', featuredHtml(config, featured));
  index = index.replace('{{POST_CARDS}}', cards);
  await fs.writeFile(path.join(DIST_DIR, 'index.html'), index, 'utf8');

  for (const post of posts) {
    const dir = path.join(DIST_DIR, String(config.postsPath || '/posts').replace(/^\//, ''), post.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), postPage(config, post), 'utf8');
  }

  const siteUrl = config.siteUrl.replace(/\/$/, '');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${xmlEscape(siteUrl)}/</loc></url>\n${posts.map(post => `  <url><loc>${xmlEscape(siteUrl + postHref(config, post))}</loc><lastmod>${xmlEscape(post.date)}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  await fs.writeFile(path.join(DIST_DIR, 'sitemap.xml'), sitemap, 'utf8');
  await fs.writeFile(path.join(DIST_DIR, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`, 'utf8');

  const feedItems = posts.slice(0, 20).map(post => `    <item>\n      <title>${xmlEscape(post.title)}</title>\n      <link>${xmlEscape(siteUrl + postHref(config, post))}</link>\n      <guid>${xmlEscape(siteUrl + postHref(config, post))}</guid>\n      <pubDate>${new Date(`${post.date}T12:00:00Z`).toUTCString()}</pubDate>\n      <description>${xmlEscape(post.description)}</description>\n    </item>`).join('\n');
  const feed = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n    <title>${xmlEscape(config.siteName)}</title>\n    <link>${xmlEscape(siteUrl)}</link>\n    <description>${xmlEscape(config.description)}</description>\n${feedItems}\n  </channel></rss>\n`;
  await fs.writeFile(path.join(DIST_DIR, 'feed.xml'), feed, 'utf8');

  const manifest = posts.map(post => ({
    id: post.id,
    title: post.title,
    description: post.description,
    excerpt: post.excerpt,
    date: post.date,
    category: post.category,
    banner: post.banner,
    featured: post.featured,
    badges: post.badges,
    tags: post.tags,
    authors: post.authors,
    url: postHref(config, post)
  }));
  await fs.writeFile(path.join(DIST_DIR, 'posts.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`✓ Build concluído: ${posts.length} post(s) publicado(s).`);
  console.log(`✓ Saída: ${normalizeRootPath(path.relative(ROOT, DIST_DIR))}/`);
  if (featured) console.log(`★ Destaque: ${featured.id}`);
}

async function ask(rl, label, fallback = '') {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

async function createPost() {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('\nNovo post\n');
    const title = await ask(rl, 'Post Title');
    if (!title) throw new Error('Título é obrigatório.');

    let id = await ask(rl, 'ID', slugify(title));
    id = slugify(id);
    if (!validId(id)) throw new Error('ID inválido. Use letras minúsculas, números e hífen.');

    const destination = path.join(CONTENT_DIR, `${id}.md`);
    try {
      await fs.access(destination);
      throw new Error(`Já existe um post com o arquivo ${id}.md.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const bannerInput = await ask(rl, 'Post Banner (vazio/null = nenhum)');
    const banner = normalizeBanner(bannerInput);
    const category = await ask(rl, 'Categoria (dev/projects/ideas)', 'dev');
    const badgesInput = await ask(rl, 'Badges, separadas por vírgula');
    const tagsInput = await ask(rl, 'Tags, separadas por vírgula (linkedin/x também exibem origem)');
    const description = await ask(rl, 'Descrição curta para SEO');

    console.log('\nAuthors — use @nome|https://link. O link é opcional. Enter vazio encerra.');
    const authors = [];
    while (true) {
      const raw = await ask(rl, 'Author');
      if (!raw) break;
      const separator = raw.indexOf('|');
      const name = (separator === -1 ? raw : raw.slice(0, separator)).trim();
      const link = separator === -1 ? '' : raw.slice(separator + 1).trim();
      if (name) authors.push({ name, link: link || null });
    }

    console.log('\nButtons — use Label|link. Enter vazio encerra.');
    const buttons = [];
    while (true) {
      const raw = await ask(rl, 'Button');
      if (!raw) break;
      const separator = raw.indexOf('|');
      if (separator <= 0) {
        console.log('  Use o formato Label|https://link');
        continue;
      }
      const label = raw.slice(0, separator).trim();
      const link = raw.slice(separator + 1).trim();
      if (label && link) buttons.push({ label, link });
    }

    const badges = badgesInput.split(',').map(v => v.trim()).filter(Boolean);
    const tags = tagsInput.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);

    const lines = [
      '---',
      `id: ${id}`,
      `title: ${quoteYaml(title)}`,
      `description: ${description ? quoteYaml(description) : '""'}`,
      `date: ${quoteYaml(today)}`,
      `category: ${category || 'dev'}`,
      `banner: ${banner ? quoteYaml(banner.replace(/^\//, '')) : 'null'}`,
      'featured: false',
      'draft: false',
      'badges:'
    ];
    if (badges.length) lines.push(...badges.map(badge => `  - ${quoteYaml(badge)}`));
    lines.push('tags:');
    if (tags.length) lines.push(...tags.map(tag => `  - ${quoteYaml(tag)}`));
    lines.push('authors:');
    if (authors.length) {
      lines.push(...authors.map(author => {
        const value = author.link ? `${author.name}(${author.link})` : author.name;
        return `  - ${quoteYaml(value)}`;
      }));
    }
    lines.push('buttons:');
    if (buttons.length) {
      for (const button of buttons) {
        lines.push(`  - label: ${quoteYaml(button.label)}`);
        lines.push(`    link: ${quoteYaml(button.link)}`);
      }
    }
    lines.push('---', '', 'Comece a escrever aqui.', '');

    await fs.mkdir(CONTENT_DIR, { recursive: true });
    await fs.writeFile(destination, lines.join('\n'), 'utf8');
    console.log(`\n✓ Criado: ${normalizeRootPath(path.relative(ROOT, destination))}`);
    console.log('Edite o Markdown e rode: npm run build');
  } finally {
    rl.close();
  }
}

function setFeaturedInSource(source, featured) {
  const normalized = source.replace(/\r\n/g, '\n');
  const closing = normalized.indexOf('\n---\n', 4);
  if (!normalized.startsWith('---\n') || closing === -1) throw new Error('Front matter inválido.');
  const head = normalized.slice(0, closing);
  const tail = normalized.slice(closing);
  const line = `featured: ${featured ? 'true' : 'false'}`;
  if (/^featured:\s*(true|false)\s*$/m.test(head)) {
    return head.replace(/^featured:\s*(true|false)\s*$/m, line) + tail;
  }
  return `${head}\n${line}${tail}`;
}

async function featurePost(id, enabled) {
  if (!id) throw new Error(`Informe o ID: node blog.mjs ${enabled ? 'emp' : 'unemp'} <id>`);
  const posts = await loadPosts({ includeDrafts: true });
  const target = posts.find(post => post.id === id);
  if (!target) throw new Error(`Post "${id}" não encontrado.`);

  if (enabled) {
    for (const post of posts) {
      const next = setFeaturedInSource(post.source, post.id === id);
      if (next !== post.source.replace(/\r\n/g, '\n')) await fs.writeFile(post.file, next, 'utf8');
    }
    console.log(`★ ${id} agora é o post em destaque.`);
  } else {
    const next = setFeaturedInSource(target.source, false);
    await fs.writeFile(target.file, next, 'utf8');
    console.log(`✓ Destaque removido de ${id}.`);
  }
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif'
  })[ext] || 'application/octet-stream';
}

async function serve(port = 4173) {
  await build();
  let rebuilding = false;
  const rebuild = async () => {
    if (rebuilding) return;
    rebuilding = true;
    try { await build(); } catch (error) { console.error(`Build falhou: ${error.message}`); }
    finally { rebuilding = false; }
  };

  for (const folder of [CONTENT_DIR, path.join(ROOT, 'src'), PUBLIC_DIR, IMAGES_DIR]) {
    try {
      fsWatch(folder, { recursive: true }, () => rebuild());
    } catch {
      // Recursive watching is not available on every platform; dev server still works.
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const requested = path.resolve(DIST_DIR, `.${pathname}`);
      if (!requested.startsWith(DIST_DIR)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      let file = requested;
      try {
        const stat = await fs.stat(file);
        if (stat.isDirectory()) file = path.join(file, 'index.html');
      } catch {
        if (!path.extname(file)) file = path.join(file, 'index.html');
      }
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mimeType(file), 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 — Não encontrado');
    }
  });

  server.listen(port, () => console.log(`\nDev server: http://localhost:${port}\n`));
}

async function main() {
  const [, , command = 'build', ...args] = process.argv;
  switch (command) {
    case 'build': await build(); break;
    case 'post': await createPost(); break;
    case 'emp': await featurePost(args[0], true); break;
    case 'unemp': await featurePost(args[0], false); break;
    case 'dev': await serve(Number(args[0]) || 4173); break;
    case 'help':
    case '--help':
    case '-h':
      console.log(`Victor Feed\n\nnode blog.mjs post\nnode blog.mjs build\nnode blog.mjs emp <id>\nnode blog.mjs unemp <id>\nnode blog.mjs dev [porta]`);
      break;
    default: throw new Error(`Comando desconhecido: ${command}`);
  }
}

main().catch(error => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});

# Victor Feed

Feed estático em **Node.js + Markdown**.

O Node.js só é usado para criar posts, gerar o site e servir localmente. O site publicado é HTML/CSS/JS estático e continua indexável pelo Google.

## Começando

```bash
npm install
npm run post
npm run dev
```

Para gerar o site manualmente:

```bash
npm run build
```

## Estrutura

```text
.
├─ blog.mjs
├─ site.config.json
├─ content/
│  └─ posts/
├─ images/
│  └─ posts/
├─ public/
│  ├─ favicon.png
│  └─ apple-touch-icon.png
├─ src/
│  └─ index.template.html
├─ .github/
│  └─ workflows/deploy.yml
└─ dist/                    # gerada localmente; NÃO entra no Git
```

`dist/` está no `.gitignore`.

No GitHub:

```text
main (fontes)
   ↓ push
GitHub Actions
   ↓ npm run build
dist/
   ↓ publica somente o conteúdo
gh-pages (raiz do site)
```

A branch publicada contém `index.html`, `posts/`, `images/`, `posts.json`, `sitemap.xml`, `robots.txt`, `feed.xml`, `CNAME` e `.nojekyll` diretamente na raiz. Não existe `dist/` na URL.

## Criar post

```bash
npm run post
```

A CLI cria `content/posts/<id>.md` e pergunta título, ID, banner, categoria, badges, tags, descrição SEO, autores e botões.

## Front matter

```md
---
id: disfox-api
title: "A nova API do Disfox"
description: "O que mudou e por que eu resolvi simplificar a API."
date: "2026-10-05"
category: dev
banner: "images/posts/disfox-api.png"
featured: false
draft: false

badges:
  - "TypeScript"
  - "Discord"

tags:
  - "linkedin"
  - "x"
  - "disfox"

authors:
  - "@ipxzfoxy(https://victorbotelho.com.br)"
  - "@outroautor"

buttons:
  - label: "Ver documentação"
    link: "https://disfox.js.org"
  - label: "GitHub"
    link: "https://github.com/DisfoxJS/Disfox"
---

Aqui começa o conteúdo real do post em **Markdown**.
```

### Authors

A sintaxe escolhida é:

```yaml
authors:
  - "@autor(https://link-do-autor.com)"
  - "@autor-sem-link"
```

O link é opcional. Na página principal o autor aparece discreto; dentro do post recebe mais destaque. O `@autor` vira clicável quando houver link.

A CLI usa:

```text
Author: @autor|https://link-do-autor.com
Author: @outroautor
Author:
```

Enter vazio encerra.

## Banner

Coloque o arquivo em:

```text
images/posts/disfox-api.png
```

E use:

```yaml
banner: "images/posts/disfox-api.png"
```

Se o arquivo não existir, o build avisa e não publica uma imagem quebrada.

## Cards do Feed

Cada card pode mostrar:

- banner;
- badges;
- título;
- `description` do front matter;
- um trecho curto do conteúdo Markdown em texto menor;
- autores;
- origem LinkedIn/X;
- categoria e data.

A `description` continua sendo usada em SEO, Open Graph e nos cards.

## Markdown + HTML

O renderer suporta títulos, negrito, itálico, tachado, código inline, links, imagens, listas, blockquotes, blocos de código, linha horizontal e HTML direto no Markdown.

## Destaque

```bash
npm run emp -- recap-de-setembro
```

Para remover:

```bash
npm run unemp -- recap-de-setembro
```

## Build

```bash
npm run build
```

Gera:

```text
dist/
├─ index.html
├─ favicon.png
├─ apple-touch-icon.png
├─ CNAME
├─ .nojekyll
├─ posts.json
├─ sitemap.xml
├─ robots.txt
├─ feed.xml
├─ images/...
└─ posts/
   └─ <id>/
      └─ index.html
```

Cada post recebe HTML completo, canonical, Open Graph, Twitter Card e JSON-LD `BlogPosting`.

## Desenvolvimento local

```bash
npm run dev
```

Abra:

```text
http://localhost:4173/
```

Posts:

```text
http://localhost:4173/posts/recap-de-setembro/
```

## Publicar no GitHub Pages

```bash
git add .
git commit -m "Update Feed"
git push
```

Na primeira vez:

```text
Settings → Pages → Build and deployment
Deploy from a branch
Branch: gh-pages
Folder: / (root)
```

Domínio:

```text
https://blog.victorbotelho.com.br
```

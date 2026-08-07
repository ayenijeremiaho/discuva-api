import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import MarkdownIt from 'markdown-it';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private homepageHtml: string | null = null;

  constructor(private readonly config: ConfigService) {}

  getHomepage(): string {
    if (this.homepageHtml) return this.homepageHtml;

    const mdPath = path.resolve(__dirname, '..', 'docs', 'TECH_DOC.md');
    if (!fs.existsSync(mdPath)) {
      this.logger.warn(
        `TECH_DOC.md not found at ${mdPath} — serving placeholder`,
      );
      this.homepageHtml = this.wrap(
        '<p>Technical documentation not available.</p>',
      );
      return this.homepageHtml;
    }

    const md = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
    });

    const slugify = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();

    md.renderer.rules.heading_open = (tokens, idx) => {
      const tag = tokens[idx].tag;
      const inline = tokens[idx + 1];
      const text = (inline?.children ?? []).map((t) => t.content).join('');
      return `<${tag} id="${slugify(text)}">`;
    };

    this.homepageHtml = this.wrap(md.render(fs.readFileSync(mdPath, 'utf-8')));
    this.logger.log(`TECH_DOC.md rendered and cached from ${mdPath}`);
    return this.homepageHtml;
  }

  private wrap(content: string): string {
    const product = this.config.get<string>('PRODUCT_NAME') ?? 'Discuva';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${product} — API Docs</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{background:#F4F1EA;color:#121212;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.7}
    header{background:#121212;padding:14px 40px;display:flex;align-items:center;gap:20px;position:sticky;top:0;z-index:10}
    .logo{font-size:13px;font-weight:600;color:#EADCC9;letter-spacing:-.01em;white-space:nowrap}
    .logo span{color:#8A817C;font-weight:300;margin-left:4px}
    .search-wrap{flex:1;max-width:360px;position:relative}
    .search-wrap input{width:100%;height:32px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);color:#EADCC9;font-size:12px;padding:0 12px 0 32px;outline:none;border-radius:4px;font-family:inherit}
    .search-wrap input::placeholder{color:#8A817C}
    .search-wrap input:focus{border-color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.1)}
    .search-wrap svg{position:absolute;left:9px;top:50%;transform:translateY(-50%);width:13px;height:13px;stroke:#8A817C;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
    .health{font-size:10px;color:#8A817C;text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;transition:color .15s;margin-left:auto;white-space:nowrap}
    .health:hover{color:#EADCC9}
    main{max-width:900px;margin:0 auto;padding:48px 32px 80px}
    h1{font-size:28px;font-weight:600;margin-bottom:6px;letter-spacing:-.02em}
    h2{font-size:17px;font-weight:600;margin:44px 0 12px;padding-bottom:8px;border-bottom:1px solid #E0D9D0;letter-spacing:-.01em}
    h3{font-size:13px;font-weight:700;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.5px;color:#8A817C}
    h4{font-size:13px;font-weight:600;margin:16px 0 6px}
    p{font-size:13px;color:#3a3a3a;font-weight:300;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;margin:12px 0 28px;font-size:12px;background:#fff;border:1px solid rgba(18,18,18,.08)}
    th{background:#121212;color:#EADCC9;text-align:left;padding:9px 12px;font-size:10px;letter-spacing:.8px;text-transform:uppercase;font-weight:600;white-space:nowrap}
    td{padding:8px 12px;border-bottom:1px solid #F4F1EA;color:#3a3a3a;font-weight:300;vertical-align:top;font-size:12px}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#faf8f3}
    code{font-family:"SF Mono",Consolas,"Courier New",monospace;font-size:11px;background:#F4F1EA;padding:2px 6px;border:1px solid #E0D9D0;color:#121212;border-radius:2px}
    pre{background:#121212;color:#EADCC9;padding:20px 24px;margin:12px 0 24px;overflow-x:auto;border-radius:2px}
    pre code{background:transparent;border:none;font-size:12px;padding:0;color:inherit}
    ul,ol{font-size:13px;font-weight:300;color:#3a3a3a;padding-left:20px;margin-bottom:12px}
    li{margin-bottom:4px}
    strong{font-weight:600;color:#121212}
    em{font-style:italic;color:#8A817C}
    hr{border:none;border-top:1px solid #E0D9D0;margin:36px 0}
    blockquote{border-left:3px solid #EADCC9;padding:8px 16px;background:#fff;margin:12px 0 20px;color:#8A817C;font-size:13px;font-style:italic}
    a{color:#121212;text-underline-offset:2px}
    a:hover{color:#8A817C}
    .no-results{display:none;padding:40px 0;text-align:center;font-size:13px;color:#8A817C}
    footer{border-top:1px solid #E0D9D0;padding:20px 40px;text-align:center;font-size:10px;color:#8A817C;letter-spacing:.5px;margin-top:40px}
    @media(max-width:640px){main{padding:32px 20px}header{padding:12px 20px;flex-wrap:wrap}.search-wrap{max-width:100%;order:3;flex-basis:100%}}
  </style>
</head>
<body>
  <header>
    <span class="logo">${product}<span>/ API Reference</span></span>
    <div class="search-wrap">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="search" type="search" placeholder="Search documentation…" autocomplete="off" spellcheck="false"/>
    </div>
    <a href="/health" class="health">Health &#8599;</a>
  </header>
  <main id="main">${content}</main>
  <div class="no-results" id="no-results">No sections matched your search.</div>
  <footer>${product} &mdash; Generated from TECH_DOC.md &mdash; Restart to refresh</footer>
  <script>
    (function () {
      var main = document.getElementById('main');
      var input = document.getElementById('search');
      var noResults = document.getElementById('no-results');
      var sections = [];

      // Group DOM children into sections split on every H2
      (function buildSections() {
        var nodes = Array.from(main.childNodes);
        var current = null;
        nodes.forEach(function (node) {
          if (node.nodeType === 1 && node.tagName === 'H2') {
            current = { heading: node.textContent.toLowerCase(), els: [node] };
            sections.push(current);
          } else if (current) {
            current.els.push(node);
          }
        });
      }());

      function setVisible(el, show) {
        el.style.display = show ? '' : 'none';
      }

      input.addEventListener('input', function () {
        var term = this.value.trim().toLowerCase();
        if (!term) {
          sections.forEach(function (s) { s.els.forEach(function (el) { setVisible(el, true); }); });
          noResults.style.display = 'none';
          return;
        }
        var matched = 0;
        sections.forEach(function (s) {
          var text = s.els.map(function (el) { return el.textContent || ''; }).join(' ').toLowerCase();
          var show = text.includes(term);
          s.els.forEach(function (el) { setVisible(el, show); });
          if (show) matched++;
        });
        noResults.style.display = matched === 0 ? 'block' : 'none';
      });

      // Keyboard shortcut: / to focus search
      document.addEventListener('keydown', function (e) {
        if (e.key === '/' && document.activeElement !== input) {
          e.preventDefault();
          input.focus();
        }
      });
    }());
  </script>
</body>
</html>`;
  }
}

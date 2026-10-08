// Builds src/bible-games/data/ from public-domain and CC-BY sources:
//   kjv.json      KJV text, { BOOK: [[verse1, verse2, ...], ...chapters] }
//   popular.json  ["JHN.3.16", ...] verses ranked by how often they're cross-referenced (best known first)
//   related.json  { "ROM.8.28": ["GEN.50.20", ...] } strongest cross-references for well-known verses
// Cross references © OpenBible.info, CC-BY. Usage: node scripts/build-bible-data.mjs [kjv_vpl.txt] [cross_references.txt]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = new URL("../src/bible-games/data/", import.meta.url);
const KJV_ZIP = "https://ebible.org/Scriptures/eng-kjv2006_vpl.zip";
const XREF_ZIP = "https://a.openbible.info/data/cross-references.zip";
const POPULAR_COUNT = 4000;
const RELATED_MIN_VOTES = 40;
const RELATED_PER_VERSE = 3;

const CODES = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD","REV"];
const OSIS = ["Gen","Exod","Lev","Num","Deut","Josh","Judg","Ruth","1Sam","2Sam","1Kgs","2Kgs","1Chr","2Chr","Ezra","Neh","Esth","Job","Ps","Prov","Eccl","Song","Isa","Jer","Lam","Ezek","Dan","Hos","Joel","Amos","Obad","Jonah","Mic","Nah","Hab","Zeph","Hag","Zech","Mal","Matt","Mark","Luke","John","Acts","Rom","1Cor","2Cor","Gal","Eph","Phil","Col","1Thess","2Thess","1Tim","2Tim","Titus","Phlm","Heb","Jas","1Pet","2Pet","1John","2John","3John","Jude","Rev"];
const FROM_OSIS = new Map(OSIS.map((o, i) => [o, CODES[i]]));
const KJV_CODE = { SOL: "SNG", EZE: "EZK", JOE: "JOL", NAH: "NAM", MAR: "MRK", JOH: "JHN", PHI: "PHP", JAM: "JAS", "1JO": "1JN", "2JO": "2JN", "3JO": "3JN" };
// Psalm titles sit at the start of verse 1 in this edition; questions should use the psalm's own words.
const PSALM_TITLE = /^(?:(?:To the chief Musician|A Psalm|A Song|A Prayer|Maschil|Michtam|Shiggaion|Of David)[^.]*\.\s*)+/;

async function unzipFrom(url, entry) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const zip = join(tmpdir(), `bible-${Date.now()}.zip`);
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  return execFileSync("unzip", ["-p", zip, entry], { maxBuffer: 64 << 20 }).toString("utf8");
}

function parseKjv(src) {
  const books = {};
  for (const line of src.split(/\r?\n/)) {
    const m = /^(\w{3}) (\d+):(\d+) (.*)$/.exec(line);
    if (!m) continue;
    const code = KJV_CODE[m[1]] ?? m[1];
    const [ch, vs] = [Number(m[2]), Number(m[3])];
    let text = m[4].replace(/[[\]¶]/g, "").replace(/\s+/g, " ").trim();
    if (code === "PSA" && vs === 1) text = text.replace(PSALM_TITLE, "");
    const chapters = (books[code] ??= []);
    const verses = (chapters[ch - 1] ??= []);
    while (verses.length < vs - 1) verses.push("");
    verses[vs - 1] = text;
  }
  for (const c of CODES) if (!books[c]) throw new Error(`KJV missing ${c}`);
  return books;
}

// "Gen.1.1" -> "GEN.1.1"; ranges and unknown books -> null.
function ref(osis) {
  if (osis.includes("-")) return null;
  const [b, c, v] = osis.split(".");
  const code = FROM_OSIS.get(b);
  return code && c && v ? `${code}.${c}.${v}` : null;
}

function parseXref(src, kjv) {
  const exists = (r) => {
    const [b, c, v] = r.split(".");
    return !!kjv[b]?.[Number(c) - 1]?.[Number(v) - 1];
  };
  const score = new Map();
  const links = new Map();
  for (const line of src.split(/\r?\n/).slice(1)) {
    const [from, to, votesText] = line.split("\t");
    const votes = Number(votesText);
    if (!from || !to || !(votes > 0)) continue;
    const a = ref(from);
    const b = ref(to);
    if (a && exists(a)) score.set(a, (score.get(a) ?? 0) + votes);
    if (b && exists(b)) score.set(b, (score.get(b) ?? 0) + votes);
    if (a && b && exists(a) && exists(b) && votes >= RELATED_MIN_VOTES && a.split(".")[0] !== b.split(".")[0]) {
      const list = links.get(a) ?? [];
      list.push([b, votes]);
      links.set(a, list);
    }
  }
  const popular = [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, POPULAR_COUNT).map(([r]) => r);
  const top = new Set(popular);
  const related = {};
  for (const [a, list] of links) {
    if (!top.has(a)) continue;
    related[a] = list.sort((x, y) => y[1] - x[1]).slice(0, RELATED_PER_VERSE).map(([r]) => r);
  }
  return { popular, related };
}

const [kjvPath, xrefPath] = process.argv.slice(2);
const kjv = parseKjv(kjvPath ? await readFile(kjvPath, "utf8") : await unzipFrom(KJV_ZIP, "eng-kjv2006_vpl.txt"));
const { popular, related } = parseXref(xrefPath ? await readFile(xrefPath, "utf8") : await unzipFrom(XREF_ZIP, "cross_references.txt"), kjv);
await mkdir(OUT, { recursive: true });
await writeFile(new URL("kjv.json", OUT), JSON.stringify(kjv));
await writeFile(new URL("popular.json", OUT), JSON.stringify(popular));
await writeFile(new URL("related.json", OUT), JSON.stringify(related));
console.log(`kjv: 66 books; popular: ${popular.length}; related: ${Object.keys(related).length} verses`);

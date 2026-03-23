import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
const pdfParse = require('pdf-parse');
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface SourceConfig {
  name: string;
  baseUrl: string;
  urls: string[];
  source: string;
  category: string;
}

const SOURCES: SourceConfig[] = [
  {
    name: 'UIF - Quaderni Antiriciclaggio',
    baseUrl: 'https://uif.bancaditalia.it',
    urls: ['https://uif.bancaditalia.it/pubblicazioni/quaderni/index.html'],
    source: 'UIF',
    category: 'AML',
  },
  {
    name: 'FATF - Publications',
    baseUrl: 'https://www.fatf-gafi.org',
    urls: ['https://www.fatf-gafi.org/en/publications/Fatfrecommendations.html'],
    source: 'FATF',
    category: 'AML',
  },
  {
    name: 'EBA - Guidelines',
    baseUrl: 'https://www.eba.europa.eu',
    urls: ['https://www.eba.europa.eu/regulation-and-policy/anti-money-laundering-and-countering-financing-terrorism'],
    source: 'EBA',
    category: 'AML',
  },
];

async function findAllPDFLinks(url: string, baseUrl: string): Promise<string[]> {
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 30000,
    });

    const $ = cheerio.load(html);
    const pdfLinks: Set<string> = new Set();

    $('a[href$=".pdf"], a[href*=".pdf"]').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        const normalized = normalizeURL(href, baseUrl, url);
        if (normalized && normalized.includes('.pdf')) {
          pdfLinks.add(normalized);
        }
      }
    });

    return Array.from(pdfLinks);
  } catch (error: any) {
    console.error(`Error fetching ${url}: ${error.message}`);
    return [];
  }
}

function normalizeURL(href: string, baseUrl: string, pageUrl: string): string | null {
  try {
    if (href.startsWith('http')) return href;
    const base = new URL(baseUrl);
    if (href.startsWith('/')) return `${base.protocol}//${base.host}${href}`;
    
    const page = new URL(pageUrl);
    const pathParts = page.pathname.split('/').slice(0, -1);
    const hrefParts = href.split('/').filter(p => p !== '.' && p !== '..');
    const finalPath = [...pathParts, ...hrefParts].join('/');
    return `${base.protocol}//${base.host}${finalPath}`;
  } catch {
    return null;
  }
}

async function downloadPDF(url: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 90000,
      maxContentLength: 200 * 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/pdf' },
    });
    return Buffer.from(response.data);
  } catch {
    return null;
  }
}

async function extractText(pdfBuffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(pdfBuffer);
    return data.text;
  } catch {
    return '';
  }
}

function chunkText(text: string): string[] {
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length < 200) return [];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const p of paragraphs) {
    if ((current + p).length > 2000 && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += (current ? '\n\n' : '') + p;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter(c => c.length > 150);
}

async function scrapeEverything(): Promise<void> {
  console.log('\n🐼 SCRAPING COMPLETO');
  console.log('━'.repeat(80));

  let totalInserted = 0;

  for (const source of SOURCES) {
    console.log(`\n📚 ${source.name}`);

    const allPDFs: Set<string> = new Set();
    
    for (const url of source.urls) {
      console.log(`Scanning: ${url}`);
      const links = await findAllPDFLinks(url, source.baseUrl);
      links.forEach(l => allPDFs.add(l));
      console.log(`Found ${links.length} PDFs`);
    }

    const pdfs = Array.from(allPDFs);
    console.log(`Total: ${pdfs.length} PDFs\n`);

    for (let i = 0; i < pdfs.length; i++) {
      const pdfUrl = pdfs[i];
      const fileName = pdfUrl.split('/').pop() || `doc_${i}`;
      
      console.log(`[${i + 1}/${pdfs.length}] ${fileName}`);

      const buffer = await downloadPDF(pdfUrl);
      if (!buffer) {
        console.log('  ❌ Download failed\n');
        continue;
      }

      const text = await extractText(buffer);
      if (text.length < 500) {
        console.log('  ⚠️ Too short\n');
        continue;
      }

      const chunks = chunkText(text);
      console.log(`  ✅ ${chunks.length} chunks`);

      for (let j = 0; j < chunks.length; j++) {
        const title = chunks.length > 1 
          ? `${fileName.replace('.pdf', '')} - Part ${j + 1}`
          : fileName.replace('.pdf', '');

        await supabase.from('aml_knowledge').insert({
          title,
          content: chunks[j],
          source: source.source,
          category: source.category,
          date: new Date().toISOString().split('T')[0],
        });
        
        totalInserted++;
      }

      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n✅ Total inserted: ${totalInserted}\n`);
}

scrapeEverything().catch(console.error);
import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';

interface SearchResult {
  source: string;
  url: string;
  title: string;
  snippet: string;
}

interface ScrapeResult {
  source: string;
  url: string;
  found: boolean;
  content: string;
  fullContent: string;
}

interface ContentResult {
  url: string;
  title: string;
  content: string;
  source: string;
}

const SOURCES = [
  {
    name: 'Banca Italia - News',
    url: 'https://www.bancaditalia.it/media/notizie/index.html',
    selector: '.news-list, .content, main',
  },
  {
    name: 'UIF - Comunicazioni',
    url: 'https://uif.bancaditalia.it/normativa/norm-comunicazioni-uif/index.html',
    selector: '.content, main, article',
  },
];

async function scrapeSite(source: typeof SOURCES[0], query: string): Promise<ScrapeResult | null> {
  try {
    console.log(`🔍 Scraping ${source.name}...`);
    
    const { data } = await axios.get(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    $('script, style, nav, header, footer').remove();
    
    const content = $(source.selector).first().text()
      .replace(/\s+/g, ' ')
      .trim();

    if (content.length > 100) {
      return {
        source: source.name,
        url: source.url,
        found: true,
        content: content.substring(0, 500),
        fullContent: content.substring(0, 3000),
      };
    }

    return null;

  } catch (error: any) {
    console.error(`❌ Error scraping ${source.name}:`, error.message);
    return null;
  }
}

async function fallbackDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    console.log(`🦆 Trying DuckDuckGo for: "${query}"`);
    
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' antiriciclaggio OR AML OR compliance')}`;
    
    const { data } = await axios.get(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const results: SearchResult[] = [];

    $('.result, .results_links_deep').slice(0, 5).each((_, elem) => {
      const title = $(elem).find('a.result__a').text().trim();
      const link = $(elem).find('a.result__a').attr('href');
      const snippet = $(elem).find('.result__snippet').text().trim();

      if (title && link) {
        results.push({
          source: 'DuckDuckGo',
          title,
          url: link,
          snippet,
        });
      }
    });

    console.log(`✅ DuckDuckGo found ${results.length} results`);
    return results;

  } catch (error: any) {
    console.error('❌ DuckDuckGo failed:', error.message);
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query required' }, { status: 400 });
    }

    console.log(`\n🌐 Web search for: "${query}"`);

    // Prova scraping diretto
    const scrapePromises = SOURCES.map(source => scrapeSite(source, query));
    const scrapeResults = await Promise.all(scrapePromises);
    const validScrapes = scrapeResults.filter((r): r is ScrapeResult => r !== null);

    console.log(`📊 Direct scrapes: ${validScrapes.length}/${SOURCES.length}`);

    // Sempre prova DuckDuckGo come backup
    const ddgResults = await fallbackDuckDuckGo(query);

    const allResults: SearchResult[] = [
      ...validScrapes.map(r => ({
        title: `${r.source} - Contenuto trovato`,
        link: r.url,
        snippet: r.content,
        source: r.source,
        url: r.url,
      })),
      ...ddgResults,
    ];

    console.log(`✅ Total results: ${allResults.length}`);

    // Scrape content dalle prime 2 pagine
    const contentPromises = allResults.slice(0, 3).map(async (result): Promise<ContentResult> => {
      try {
        const { data } = await axios.get(result.url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000,
        });

        const $ = cheerio.load(data);
        $('script, style, nav, header, footer').remove();
        
        const text = $('main, article, .content, body')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 2000);

        return {
          url: result.url,
          title: result.title,
          content: text,
          source: result.source,
        };

      } catch {
        return {
          url: result.url,
          title: result.title,
          content: result.snippet || 'Contenuto non disponibile',
          source: result.source,
        };
      }
    });

    const content = await Promise.all(contentPromises);

    return NextResponse.json({
      results: allResults,
      content: content.filter(c => c.content.length > 100),
    });

  } catch (error: any) {
    console.error('❌ Web search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: error.message },
      { status: 500 }
    );
  }
}

// ✅ CAMBIA DA edge A nodejs
export const runtime = 'nodejs';
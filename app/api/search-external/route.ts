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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
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

// ========================================
// BING SEARCH (Illimitato via HTML scraping)
// ========================================

async function bingSearch(query: string): Promise<SearchResult[]> {
  try {
    console.log(`🔍 Bing search: "${query}"`);
    
    // Costruisci query ottimizzata
    let searchQuery = buildOptimizedQuery(query);
    
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`;
    
    const { data } = await axios.get(bingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const results: SearchResult[] = [];

    // Parse Bing results
    $('.b_algo').slice(0, 5).each((_, elem) => {
      const title = $(elem).find('h2 a').text().trim();
      const link = $(elem).find('h2 a').attr('href');
      const snippet = $(elem).find('.b_caption p').text().trim();

      if (title && link && link.startsWith('http')) {
        results.push({
          source: new URL(link).hostname,
          title,
          url: link,
          snippet,
        });
      }
    });

    console.log(`✅ Bing: ${results.length} results`);
    return results;

  } catch (error: any) {
    console.error('❌ Bing error:', error.message);
    return [];
  }
}

// ========================================
// DUCKDUCKGO SEARCH (Fallback)
// ========================================

async function fallbackDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    console.log(`🦆 DuckDuckGo: "${query}"`);
    
    const searchQuery = buildOptimizedQuery(query);
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    
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

    console.log(`✅ DuckDuckGo: ${results.length} results`);
    return results;

  } catch (error: any) {
    console.error('❌ DuckDuckGo error:', error.message);
    return [];
  }
}

// ========================================
// QUERY OPTIMIZER
// ========================================

function buildOptimizedQuery(query: string): string {
  const queryLower = query.toLowerCase();
  
  // CASO 1: Indicatori anomalia
  if (/indicatori.*anomalia|segnali.*allerta|alert|red flag/i.test(query)) {
    const entity = query.match(/istitut[oi].*pagamento|payment.*institution|banca|bank|intermediar[io]/i)?.[0] || '';
    return `indicatori anomalia ${entity} UIF site:uif.bancaditalia.it OR site:bancaditalia.it`;
  }
  
  // CASO 2: Normativa specifica
  if (/art\.|articolo|d\.lgs|decreto|direttiva|regolamento/i.test(query)) {
    return `${query} testo normativa site:normattiva.it OR site:eur-lex.europa.eu OR site:bancaditalia.it`;
  }
  
  // CASO 3: Procedure CDD/EDD/KYC
  if (/cdd|edd|kyc|adeguata verifica|due diligence|verifica.*cliente/i.test(query)) {
    return `${query} procedura obblighi site:bancaditalia.it OR site:uif.bancaditalia.it OR site:eba.europa.eu`;
  }
  
  // CASO 4: Liste
  if (/lista|list|pep|sanzioni|sanctions|grey.*list|blacklist/i.test(query)) {
    return `${query} 2025 2026 site:fatf-gafi.org OR site:eba.europa.eu`;
  }
  
  // CASO 5: Ultime notizie
  if (/ultim[ie]|recenti|latest|recent|notizie|news/i.test(query)) {
    return `${query} 2025 2026 site:bancaditalia.it OR site:fatf-gafi.org OR site:eba.europa.eu`;
  }
  
  // CASO 6: FATF
  if (/fatf|gafi|recommendation/i.test(query)) {
    return `${query} site:fatf-gafi.org OR site:eba.europa.eu`;
  }
  
  // DEFAULT
  return `${query} AML compliance antiriciclaggio site:bancaditalia.it OR site:fatf-gafi.org OR site:eba.europa.eu`;
}

// ========================================
// MAIN ROUTE
// ========================================

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query required' }, { status: 400 });
    }

    console.log(`\n🌐 Web search: "${query}"`);

    // Direct scraping (veloce)
    const scrapePromises = SOURCES.map(source => scrapeSite(source, query));
    const scrapeResults = await Promise.all(scrapePromises);
    const validScrapes = scrapeResults.filter((r): r is ScrapeResult => r !== null);

    console.log(`📊 Direct scrapes: ${validScrapes.length}/${SOURCES.length}`);

    // Web search: Bing primary, DuckDuckGo fallback
    let searchResults = await bingSearch(query);

    if (searchResults.length === 0) {
      console.log('⚠️  Bing empty, trying DuckDuckGo...');
      searchResults = await fallbackDuckDuckGo(query);
    }

    const allResults: SearchResult[] = [
      ...validScrapes.map(r => ({
        title: `${r.source}`,
        link: r.url,
        snippet: r.content,
        source: r.source,
        url: r.url,
      })),
      ...searchResults,
    ];

    console.log(`✅ Total: ${allResults.length} results`);

    // Scrape top 3 results
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
          content: result.snippet || 'Content unavailable',
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

export const runtime = 'nodejs';
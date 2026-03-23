import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';

// ========================================
// TYPES
// ========================================

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

// ========================================
// SITI UFFICIALI DA SCANSIONARE
// ========================================

const SOURCES = [
  {
    name: 'UIF - Comunicazioni',
    url: 'https://uif.bancaditalia.it/normativa/norm-comunicazioni-uif/index.html',
    selector: '.content, main, article',
  },
  {
    name: 'UIF - Quaderni',
    url: 'https://uif.bancaditalia.it/pubblicazioni/quaderni/index.html',
    selector: '.content, main, article',
  },
  {
    name: 'Banca Italia - News AML',
    url: 'https://www.bancaditalia.it/media/notizie/index.html',
    selector: '.news-list, .content',
  },
  {
    name: 'FATF - News',
    url: 'https://www.fatf-gafi.org/en/the-fatf/what-we-do.html',
    selector: 'main, .content',
  },
  {
    name: 'EBA - AML Updates',
    url: 'https://www.eba.europa.eu/regulation-and-policy/anti-money-laundering-and-countering-financing-terrorism',
    selector: '.content, main',
  },
];

// ========================================
// DIRECT WEB SCRAPING
// ========================================

async function scrapeSite(source: typeof SOURCES[0], query: string): Promise<ScrapeResult | null> {
  try {
    console.log(`🔍 Scraping ${source.name}...`);
    
    const { data } = await axios.get(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(data);
    
    // Rimuovi elementi non utili
    $('script, style, nav, header, footer').remove();
    
    // Estrai contenuto
    const content = $(source.selector).first().text()
      .replace(/\s+/g, ' ')
      .trim();

    // Cerca query nel contenuto (case-insensitive)
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    
    if (contentLower.includes(queryLower)) {
      // Estrai contesto attorno alla query (500 chars prima/dopo)
      const index = contentLower.indexOf(queryLower);
      const start = Math.max(0, index - 500);
      const end = Math.min(content.length, index + 500);
      const snippet = content.substring(start, end);

      return {
        source: source.name,
        url: source.url,
        found: true,
        content: snippet,
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
// SEARCH SPECIFIC PAGES FOR KEYWORDS
// ========================================

async function searchSpecificPages(query: string): Promise<SearchResult[]> {
  try {
    const searches = [
      {
        name: 'Banca Italia Search',
        url: `https://www.bancaditalia.it/homepage/ricerca/index.html?q=${encodeURIComponent(query)}`,
      },
      {
        name: 'FATF Search',
        url: `https://www.fatf-gafi.org/en/search-results.html?q=${encodeURIComponent(query)}`,
      },
    ];

    const results: SearchResult[] = [];

    for (const search of searches) {
      try {
        const { data } = await axios.get(search.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
          timeout: 10000,
        });

        const $ = cheerio.load(data);
        
        // Estrai primi risultati di ricerca
        $('.search-result, .result, .news-item').slice(0, 3).each((_, elem) => {
          const title = $(elem).find('h2, h3, .title').text().trim();
          const link = $(elem).find('a').attr('href');
          const snippet = $(elem).find('p, .description, .snippet').text().trim();

          if (title && link) {
            results.push({
              source: search.name,
              title,
              url: link.startsWith('http') ? link : `https://www.bancaditalia.it${link}`,
              snippet,
            });
          }
        });

      } catch (error: any) {
        console.error(`Error searching ${search.name}:`, error.message);
      }
    }

    return results;

  } catch (error) {
    return [];
  }
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

    console.log(`\n🌐 Web search for: "${query}"`);

    // 1. Scrape siti ufficiali
    const scrapePromises = SOURCES.map(source => scrapeSite(source, query));
    const scrapeResults = await Promise.all(scrapePromises);
    const validScrapes = scrapeResults.filter((r): r is ScrapeResult => r !== null);

    // 2. Search su motori di ricerca interni
    const searchResults = await searchSpecificPages(query);

    // 3. Combina risultati
    const allResults: SearchResult[] = [
      ...validScrapes.map(r => ({
        title: `${r.source} - Match trovato`,
        link: r.url,
        snippet: r.content,
        source: r.source,
        url: r.url,
      })),
      ...searchResults,
    ];

    console.log(`✅ Found ${allResults.length} results`);

    // 4. Se ci sono risultati, scrape content completo dalle prime 2 pagine
    const contentPromises = allResults.slice(0, 2).map(async (result): Promise<ContentResult> => {
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
          .substring(0, 3000);

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
          content: result.snippet,
          source: result.source,
        };
      }
    });

    const content = await Promise.all(contentPromises);

    return NextResponse.json({
      results: allResults,
      content: content.filter(c => c.content.length > 200),
    });

  } catch (error: any) {
    console.error('❌ Web search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: error.message },
      { status: 500 }
    );
  }
}

export const runtime = 'edge';
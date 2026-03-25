import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';

interface SearchResult {
  source: string;
  url: string;
  title: string;
  snippet: string;
  date?: string;
  relevanceScore?: number;
}

interface ContentResult {
  url: string;
  title: string;
  content: string;
  source: string;
  date?: string;
  relevanceScore: number;
}

// ========================================
// MULTI-SOURCE SEARCH ENGINES
// ========================================

// Bing (primary - best for Italian content)
async function bingSearch(query: string): Promise<SearchResult[]> {
  try {
    console.log(`🔍 Bing: "${query}"`);
    
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    
    const { data } = await axios.get(bingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      timeout: 12000,
    });

    const $ = cheerio.load(data);
    const results: SearchResult[] = [];

    $('.b_algo').slice(0, 8).each((_, elem) => {
      const title = $(elem).find('h2 a').text().trim();
      const link = $(elem).find('h2 a').attr('href');
      const snippet = $(elem).find('.b_caption p').text().trim();

      if (title && link && link.startsWith('http')) {
        results.push({
          source: extractDomain(link),
          title,
          url: link,
          snippet,
        });
      }
    });

    console.log(`  ✅ Bing: ${results.length}`);
    return results;

  } catch (error: any) {
    console.error(`❌ Bing error: ${error.message}`);
    return [];
  }
}

// DuckDuckGo (fallback)
async function duckDuckGoSearch(query: string): Promise<SearchResult[]> {
  try {
    console.log(`🦆 DuckDuckGo: "${query}"`);
    
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const { data } = await axios.get(ddgUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });

    const $ = cheerio.load(data);
    const results: SearchResult[] = [];

    $('.result').slice(0, 8).each((_, elem) => {
      const title = $(elem).find('a.result__a').text().trim();
      const link = $(elem).find('a.result__a').attr('href');
      const snippet = $(elem).find('.result__snippet').text().trim();

      if (title && link) {
        results.push({
          source: extractDomain(link),
          title,
          url: link,
          snippet,
        });
      }
    });

    console.log(`  ✅ DDG: ${results.length}`);
    return results;

  } catch (error: any) {
    console.error(`❌ DDG error: ${error.message}`);
    return [];
  }
}

// Google News RSS (for latest articles)
async function googleNewsRSS(query: string): Promise<SearchResult[]> {
  try {
    console.log(`📰 Google News RSS: "${query}"`);
    
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' AML compliance antiriciclaggio')}&hl=it&gl=IT&ceid=IT:it`;
    
    const { data } = await axios.get(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });

    const $ = cheerio.load(data, { xmlMode: true });
    const results: SearchResult[] = [];

    $('item').slice(0, 5).each((_, elem) => {
      const title = $(elem).find('title').text().trim();
      const link = $(elem).find('link').text().trim();
      const pubDate = $(elem).find('pubDate').text().trim();
      const description = $(elem).find('description').text().trim();

      if (title && link) {
        results.push({
          source: extractDomain(link),
          title,
          url: link,
          snippet: description,
          date: pubDate,
        });
      }
    });

    console.log(`  ✅ Google News: ${results.length}`);
    return results;

  } catch (error: any) {
    console.error(`❌ Google News error: ${error.message}`);
    return [];
  }
}

// ========================================
// INTELLIGENT CONTENT SCRAPER
// ========================================

async function smartScrapeContent(url: string, title: string): Promise<ContentResult | null> {
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
      },
      timeout: 8000,
      maxRedirects: 3,
    });

    const $ = cheerio.load(data);
    
    // Remove noise
    $('script, style, nav, header, footer, aside, .menu, .sidebar, .ads, .cookie-banner, .social-share').remove();
    
    // Smart content extraction - try multiple selectors
    const contentSelectors = [
      'article',
      'main',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content',
      '.news-content',
      '[role="main"]',
      'body',
    ];

    let content = '';
    
    for (const selector of contentSelectors) {
      const extracted = $(selector).first().text().trim();
      if (extracted.length > content.length) {
        content = extracted;
      }
    }

    // Clean up
    content = content
      .replace(/\s+/g, ' ')
      .replace(/Cookie\s+policy.*$/i, '')
      .replace(/Privacy\s+policy.*$/i, '')
      .trim();

    // Extract metadata
    const dateSelectors = ['time', '.date', '.published', '[datetime]'];
    let date = '';
    for (const selector of dateSelectors) {
      date = $(selector).first().attr('datetime') || $(selector).first().text().trim();
      if (date) break;
    }

    if (content.length < 200) {
      return null;
    }

    // Calculate relevance score
    const relevanceScore = calculateRelevanceScore(content, title);

    return {
      url,
      title,
      content: content.substring(0, 3000),
      source: extractDomain(url),
      date,
      relevanceScore,
    };

  } catch (error: any) {
    console.error(`⚠️  Scrape failed (${url}): ${error.message}`);
    return null;
  }
}

// ========================================
// AI-POWERED RELEVANCE SCORING
// ========================================

function calculateRelevanceScore(content: string, title: string): number {
  const text = (content + ' ' + title).toLowerCase();
  let score = 0;

  // High-value keywords (20 points each)
  const highValueKeywords = [
    'antiriciclaggio', 'riciclaggio', 'aml', 'anti-money laundering',
    'cft', 'finanziamento terrorismo', 'terrorist financing',
    'uif', 'fatf', 'gafi', 'eba', 'esma',
    'adeguata verifica', 'customer due diligence', 'cdd', 'edd',
    'segnalazione operazioni sospette', 'sos', 'str',
    'compliance', 'normativa antiriciclaggio',
  ];
  
  highValueKeywords.forEach(keyword => {
    const regex = new RegExp(keyword, 'gi');
    const matches = text.match(regex);
    if (matches) {
      score += matches.length * 20;
    }
  });

  // Medium-value keywords (10 points each)
  const mediumValueKeywords = [
    'banca', 'istituto', 'intermediario', 'payment institution',
    'pep', 'titolare effettivo', 'beneficial owner',
    'transazione', 'operazione', 'transaction',
    'sanzioni', 'sanctions', 'lista', 'blacklist',
    'rischio', 'risk', 'valutazione', 'assessment',
    'obblighi', 'requirements', 'procedure',
  ];
  
  mediumValueKeywords.forEach(keyword => {
    const regex = new RegExp(keyword, 'gi');
    const matches = text.match(regex);
    if (matches) {
      score += matches.length * 10;
    }
  });

  // Low-value keywords (5 points each)
  const lowValueKeywords = [
    'normativa', 'legislation', 'direttiva', 'directive',
    'regolamento', 'regulation', 'decreto', 'law',
    'autorità', 'authority', 'vigilanza', 'supervision',
  ];
  
  lowValueKeywords.forEach(keyword => {
    const regex = new RegExp(keyword, 'gi');
    const matches = text.match(regex);
    if (matches) {
      score += matches.length * 5;
    }
  });

  // Penalties
  if (text.includes('cookie') || text.includes('privacy policy')) {
    score -= 50;
  }

  // Bonus for official sources
  if (text.includes('bancaditalia.it') || text.includes('uif.') || text.includes('fatf-gafi.org')) {
    score += 100;
  }

  // Normalize to 0-100
  return Math.min(100, Math.max(0, score / 10));
}

// ========================================
// HELPERS
// ========================================

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace('www.', '');
  } catch {
    return 'Unknown';
  }
}

function buildSmartQuery(query: string): string {
  const queryLower = query.toLowerCase();
  
  // Base query always includes AML context
  let baseQuery = query;
  
  // Add temporal context for news queries
  if (/ultim[ie]|recenti|latest|recent|notizie|news/i.test(query)) {
    const year = new Date().getFullYear();
    baseQuery += ` ${year} ${year - 1}`;
  }
  
  // Add AML context if not present
  if (!/aml|antiriciclaggio|compliance|cft/i.test(query)) {
    baseQuery += ' AML compliance antiriciclaggio';
  }
  
  // Add document types for specific queries
  if (/indicatori|segnali|procedure|obblighi/i.test(query)) {
    baseQuery += ' linee guida circolare comunicazione';
  }
  
  return baseQuery;
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

    console.log(`\n🌐 Intelligent Multi-Source Search: "${query}"`);

    const smartQuery = buildSmartQuery(query);
    console.log(`🎯 Optimized query: "${smartQuery}"`);

    // PHASE 1: Multi-engine parallel search
    const [bingResults, ddgResults, newsResults] = await Promise.all([
      bingSearch(smartQuery),
      duckDuckGoSearch(smartQuery),
      googleNewsRSS(query),
    ]);

    // Combine and deduplicate
    const allResults = [...bingResults, ...ddgResults, ...newsResults];
    const uniqueResults = Array.from(
      new Map(allResults.map(item => [item.url, item])).values()
    );

    console.log(`📊 Total unique results: ${uniqueResults.length}`);

    // PHASE 2: Parallel intelligent scraping (top 6 results)
    const scrapePromises = uniqueResults.slice(0, 6).map(result =>
      smartScrapeContent(result.url, result.title)
    );
    
    const scrapedContents = await Promise.all(scrapePromises);
    const validContents = scrapedContents.filter((c): c is ContentResult => c !== null);

    console.log(`✅ Successfully scraped: ${validContents.length}/6`);

    // PHASE 3: Sort by relevance score
    const sortedContents = validContents.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Log relevance scores
    sortedContents.forEach(c => {
      console.log(`  📈 ${c.source}: ${c.relevanceScore.toFixed(0)}/100 - ${c.title.substring(0, 60)}...`);
    });

    // Return top 5 most relevant
    const topContents = sortedContents.slice(0, 5);

    return NextResponse.json({
      results: uniqueResults.slice(0, 10),
      content: topContents,
      stats: {
        totalFound: uniqueResults.length,
        scraped: validContents.length,
        returned: topContents.length,
        avgRelevance: topContents.length > 0 
          ? (topContents.reduce((sum, c) => sum + c.relevanceScore, 0) / topContents.length).toFixed(1)
          : 0,
      },
    });

  } catch (error: any) {
    console.error('❌ Search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: error.message },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
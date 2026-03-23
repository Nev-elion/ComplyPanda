import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';

// ========================================
// FREE SANCTIONS CHECKS (No API Keys)
// ========================================

async function checkEUSanctions(name: string) {
  try {
    console.log(`🇪🇺 Checking EU Sanctions: "${name}"`);
    
    const { data } = await axios.get(
      `https://www.sanctionsmap.eu/#/main/search/${encodeURIComponent(name)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      }
    );

    const hasMatch = data.toLowerCase().includes(name.toLowerCase());

    return {
      source: 'EU Sanctions Map',
      found: hasMatch,
      data: hasMatch 
        ? `⚠️ Potenziale match per "${name}" nelle sanzioni EU`
        : `✅ Nessun match per "${name}"`,
      url: `https://www.sanctionsmap.eu/#/main/search/${encodeURIComponent(name)}`,
    };

  } catch (error: any) {
    console.error('EU Sanctions error:', error.message);
    return null;
  }
}

async function checkOFAC(name: string) {
  try {
    console.log(`🇺🇸 Checking OFAC: "${name}"`);
    
    const { data } = await axios.get(
      'https://sanctionssearch.ofac.treas.gov/',
      {
        params: { name },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      }
    );

    const $ = cheerio.load(data);
    const results = $('.search-result, .result-item').length;

    return {
      source: 'OFAC (US Treasury)',
      found: results > 0,
      data: results > 0
        ? `⚠️ ${results} potenziali match per "${name}" in OFAC SDN`
        : `✅ Nessun match per "${name}"`,
      url: 'https://sanctionssearch.ofac.treas.gov/',
    };

  } catch (error: any) {
    console.error('OFAC error:', error.message);
    return null;
  }
}

async function checkUNSanctions(name: string) {
  try {
    console.log(`🇺🇳 Checking UN Sanctions: "${name}"`);
    
    const { data } = await axios.get(
      'https://scsanctions.un.org/search/',
      {
        params: { keywords: name },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      }
    );

    const $ = cheerio.load(data);
    const results = $('.search-result').length;

    return {
      source: 'UN Sanctions',
      found: results > 0,
      data: results > 0
        ? `⚠️ ${results} potenziali match per "${name}" nelle sanzioni UN`
        : `✅ Nessun match per "${name}"`,
      url: `https://scsanctions.un.org/search/?keywords=${encodeURIComponent(name)}`,
    };

  } catch (error: any) {
    console.error('UN Sanctions error:', error.message);
    return null;
  }
}

// ========================================
// COMPANY LOOKUPS (Free)
// ========================================

async function searchCompany(name: string) {
  try {
    console.log(`🏢 Searching company: "${name}"`);
    
    const { data } = await axios.get(
      `https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(name)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      }
    );

    const $ = cheerio.load(data);
    const companies: any[] = [];

    $('.results-list li').slice(0, 3).each((_, elem) => {
      const companyName = $(elem).find('h3').text().trim();
      const companyNumber = $(elem).find('.company-number').text().trim();
      const status = $(elem).find('.status').text().trim();

      if (companyName) {
        companies.push({ name: companyName, number: companyNumber, status });
      }
    });

    return {
      source: 'Companies House UK',
      found: companies.length > 0,
      data: companies.length > 0
        ? { count: companies.length, companies }
        : `Nessuna azienda trovata per "${name}"`,
      url: `https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(name)}`,
    };

  } catch (error: any) {
    console.error('Company search error:', error.message);
    return null;
  }
}

// ========================================
// MAIN ROUTE
// ========================================

export async function POST(request: NextRequest) {
  try {
    const { query, type } = await request.json();

    if (!query) {
      return NextResponse.json({ error: 'Query required' }, { status: 400 });
    }

    console.log(`\n🔍 API query: "${query}" (type: ${type})`);

    const results: any[] = [];

    if (type === 'sanctions' || type === 'all') {
      const [eu, ofac, un] = await Promise.all([
        checkEUSanctions(query),
        checkOFAC(query),
        checkUNSanctions(query),
      ]);

      if (eu) results.push(eu);
      if (ofac) results.push(ofac);
      if (un) results.push(un);
    }

    if (type === 'company' || type === 'all') {
      const company = await searchCompany(query);
      if (company) results.push(company);
    }

    console.log(`✅ Returning ${results.length} results`);

    return NextResponse.json({ results });

  } catch (error: any) {
    console.error('❌ API error:', error);
    return NextResponse.json(
      { error: 'API failed', details: error.message },
      { status: 500 }
    );
  }
}

export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const responseCache = new Map<string, { response: string; timestamp: number }>();
const CACHE_TTL = 3600000;

function getCacheKey(message: string): string {
  return message.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ========================================
// HELPER FUNCTIONS - Web Search & API
// ========================================

function shouldSearchWeb(message: string): boolean {
  const messageLower = message.toLowerCase();
  
  const timeTriggers = [
    'ultime', 'recenti', 'aggiornamenti', 'nuove', 'latest', 'recent', 'new',
    'oggi', 'ieri', 'yesterday', 'settimana', 'week', 'mese', 'month',
    '2024', '2025', '2026',
    'notizie', 'news', 'novità', 'update', 'aggiorna',
    'dimostra', 'cerca', 'trova', 'search', 'veloce', 'controllare internet',
  ];
  
  const docTriggers = [
    'comunicazione', 'provvedimento', 'circolare', 'parere',
    'rapporto', 'report', 'pubblicazione', 'publication',
  ];
  
  const listTriggers = [
    'lista', 'list', 'grey list', 'greylist', 'blacklist',
    'sanzion', 'sanction', 'paesi ad alto rischio', 'high risk',
  ];
  
  return [...timeTriggers, ...docTriggers, ...listTriggers].some(
    trigger => messageLower.includes(trigger)
  );
}

function shouldQueryAPIs(message: string): boolean {
  const triggers = [
    'sanzione', 'sanctioned', 'pep', 'politically exposed',
    'lista', 'blacklist', 'sdn', 'ofac',
    'società', 'company', 'azienda', 'impresa',
    'è sanzionata', 'is sanctioned', 'check',
    'grey list', 'greylist', 'paesi ad alto rischio',
  ];
  return triggers.some(trigger => message.toLowerCase().includes(trigger));
}

function detectQueryType(message: string): string {
  if (/sanzione|sanction|lista|blacklist|sdn|ofac|grey.*list/i.test(message)) return 'sanctions';
  if (/società|company|azienda|impresa|firm/i.test(message)) return 'company';
  if (/normativa|legge|direttiva|regolamento|directive|regulation/i.test(message)) return 'legislation';
  return 'all';
}

function extractEntityName(message: string): string {
  const quoted = message.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  
  const afterCheck = message.match(/(?:check|verifica|controlla|cerca)\s+([A-Z][a-zA-Z\s&.,]+?)(?:\s+(?:è|is|nella|in|sul))/i);
  if (afterCheck) return afterCheck[1].trim();
  
  const words = message.split(' ').filter(w => /^[A-Z]/.test(w));
  if (words.length > 0) return words.slice(-3).join(' ');
  
  return message.split(' ').slice(0, 5).join(' ');
}

// ========================================
// KEYWORD EXTRACTION
// ========================================

function extractKeywords(message: string): string[] {
  const keywords: string[] = [];
  const messageLower = message.toLowerCase();
  
  const specificTerms = [
    'indicatori anomalia', 'indicatori di anomalia', 'segnali di allerta',
    'istituto pagamento', 'istituti di pagamento', 'payment institution',
    'adeguata verifica', 'customer due diligence', 'cdd',
    'enhanced due diligence', 'edd', 'verifica rafforzata',
    'pep', 'persone politicamente esposte',
    'segnalazione operazioni sospette', 'sos', 'str',
    'travel rule', 'wire transfer', 'bonifico',
    'virtual assets', 'vasp', 'crypto', 'criptovalute',
    'titolare effettivo', 'beneficial owner',
    'paesi ad alto rischio', 'high risk countries',
    'grey list', 'blacklist', 'lista grigia',
    'fatf recommendation', 'raccomandazione fatf',
    'direttiva', 'regolamento', 'circolare',
    'provvedimento', 'comunicazione uif',
    'art.', 'articolo', 'd.lgs', 'decreto',
  ];
  
  specificTerms.forEach(term => {
    if (messageLower.includes(term)) {
      keywords.push(term);
    }
  });
  
  const entities = [
    'uif', 'fatf', 'gafi', 'eba', 'esma', 'consob',
    'kyc', 'aml', 'cft', 'ml/tf', 'mlro',
  ];
  
  entities.forEach(entity => {
    if (messageLower.includes(entity)) {
      keywords.push(entity);
    }
  });
  
  return [...new Set(keywords)];
}

// ========================================
// AI INTENT CLASSIFICATION
// ========================================

async function classifyIntent(message: string): Promise<{
  primary_intent: 'greeting' | 'how_are_you' | 'compliance_question' | 'off_topic';
  has_compliance_question: boolean;
  language: 'it' | 'en';
  confidence: number;
}> {
  const classificationPrompt = `You are an intent classifier. Analyze this message and return ONLY a JSON object.

Message: "${message}"

Return this exact structure:
{
  "primary_intent": "greeting" | "how_are_you" | "compliance_question" | "off_topic",
  "has_compliance_question": true/false,
  "language": "it" | "en",
  "confidence": 0.0-1.0
}

Rules:
- "primary_intent": the MAIN intent
  * "greeting": ONLY simple greeting without context
  * "how_are_you": ONLY asking wellbeing
  * "compliance_question": ANY hint of wanting AML/compliance info
    Even vague requests like "fammi vedere", "dimostra", "controlla internet"
  * "off_topic": unrelated topics

- "has_compliance_question": true if ANY indication user wants compliance info
  Keywords: AML, CFT, KYC, notizie, ultime, veloce, dimostra, controlla, cerca

- If greeting in compliance context, set:
  primary_intent: "compliance_question"
  has_compliance_question: true

Return ONLY JSON.`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: classificationPrompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 150,
    });

    const response = completion.choices[0]?.message?.content?.trim() || '{}';
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { 
      primary_intent: 'compliance_question', 
      has_compliance_question: true,
      language: 'en', 
      confidence: 0.5 
    };
  } catch (error) {
    console.error('Intent classification error:', error);
    return { 
      primary_intent: 'compliance_question',
      has_compliance_question: true, 
      language: 'en', 
      confidence: 0.5 
    };
  }
}

// ========================================
// EXTRACT SOURCES & BUILD CITATIONS
// ========================================

interface Citation {
  id: number;
  source: string;
  title: string;
  date?: string;
  url?: string;
}

function extractCitations(contextText: string, webContent: any[], apiContent: any[]): Citation[] {
  const citations: Citation[] = [];
  let citationId = 1;

  if (webContent && webContent.length > 0) {
    webContent.forEach((item: any) => {
      citations.push({
        id: citationId++,
        source: item.source || 'Web',
        title: item.title || 'Documento web',
        url: item.url,
      });
    });
  }

  if (apiContent && apiContent.length > 0) {
    apiContent.forEach((item: any) => {
      citations.push({
        id: citationId++,
        source: item.source || 'API',
        title: typeof item.data === 'string' ? item.data.substring(0, 80) : 'API Result',
        url: item.url,
      });
    });
  }

  const dbMatches = contextText.match(/\[DB - ([^\]]+?)(?: - (\d{4}-\d{2}-\d{2}))?\]/g);
  if (dbMatches) {
    const uniqueDB = new Set<string>();
    dbMatches.forEach(match => {
      const parsed = match.match(/\[DB - ([^\]]+?)(?: - (\d{4}-\d{2}-\d{2}))?\]/);
      if (parsed && !uniqueDB.has(parsed[1])) {
        uniqueDB.add(parsed[1]);
        citations.push({
          id: citationId++,
          source: parsed[1],
          title: 'Database interno',
          date: parsed[2],
        });
      }
    });
  }

  return citations;
}

function buildCitationsFooter(citations: Citation[], lang: 'it' | 'en'): string {
  if (citations.length === 0) return '';

  const header = lang === 'it' ? '\n\n---\n\n**Fonti:**\n' : '\n\n---\n\n**Sources:**\n';
  
  return header + citations.map(c => {
    const dateStr = c.date ? ` (${c.date})` : '';
    const urlStr = c.url ? ` - [Link](${c.url})` : '';
    return `\n**[${c.id}]** ${c.source}${dateStr}: ${c.title}${urlStr}`;
  }).join('');
}

// ========================================
// MAIN ROUTE HANDLER
// ========================================

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
    }

    const { primary_intent, has_compliance_question, language: lang } = await classifyIntent(message);

    if (has_compliance_question || primary_intent === 'compliance_question') {
      const cacheKey = getCacheKey(message);
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return NextResponse.json({ response: cached.response, cached: true });
      }

      // ========================================
      // 1. SEARCH DATABASE - IMPROVED
      // ========================================
      let context: any[] = [];
      const keywords = extractKeywords(message);
      
      console.log(`🔑 Keywords: ${keywords.length > 0 ? keywords.join(', ') : 'none'}`);

      if (keywords.length > 0) {
        const orConditions = keywords.map(k => `title.ilike.%${k}%,content.ilike.%${k}%`).join(',');
        
        const { data: exactMatches } = await supabase
          .from('aml_knowledge')
          .select('content, source, title, date, category')
          .or(orConditions)
          .order('date', { ascending: false })
          .limit(5);
        
        if (exactMatches) {
          context.push(...exactMatches);
          console.log(`  ✅ Exact matches: ${exactMatches.length}`);
        }
      }

      const { data: fullTextResults } = await supabase
        .from('aml_knowledge')
        .select('content, source, title, date, category')
        .textSearch('content', message)
        .order('date', { ascending: false })
        .limit(5);

      if (fullTextResults) {
        fullTextResults.forEach((result: any) => {
          if (!context.find((c: any) => c.title === result.title)) {
            context.push(result);
          }
        });
        console.log(`  ✅ Full-text results: ${fullTextResults.length}`);
      }

      context = context.slice(0, 8);

      const shouldPrioritizeWeb = !context || 
        context.length < 2 || 
        (context.every((c: any) => !c.date || new Date(c.date) < new Date('2023-01-01')));

      console.log(`📊 Total DB results: ${context?.length || 0}`);
      console.log(`⚡ Should prioritize web: ${shouldPrioritizeWeb}`);

      // ========================================
      // 2. SEARCH WEB - SEMPRE ATTIVO
      // ========================================
      let webContext = '';
      let webContentArray: any[] = [];

      console.log(`🔍 Web search: ALWAYS ON for compliance questions`);

      try {
        console.log('🌐 Triggering web search...');
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://comply-panda.vercel.app';
        const webResponse = await fetch(`${baseUrl}/api/search-external`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: message }),
        });
        
        if (webResponse.ok) {
          const webData = await webResponse.json();
          
          if (webData.content && webData.content.length > 0) {
            webContentArray = webData.content;
            webContext = webData.content
              .map((item: any, idx: number) => `[WEB-${idx + 1}] ${item.source}: ${item.title}\n${item.content}`)
              .join('\n\n---\n\n');
            console.log(`✅ Found ${webData.content.length} web results`);
          } else {
            console.log('⚠️  Web search returned no results');
          }
        } else {
          console.error(`❌ Web search failed: ${webResponse.status}`);
        }
      } catch (error: any) {
        console.error('❌ Web search error:', error.message);
      }

      // ========================================
      // 3. QUERY EXTERNAL APIs (if needed)
      // ========================================
      let apiContext = '';
      let apiContentArray: any[] = [];
      if (shouldQueryAPIs(message)) {
        try {
          console.log('🔍 Querying external APIs...');
          const entityName = extractEntityName(message);
          const queryType = detectQueryType(message);
          
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://comply-panda.vercel.app';
          const apiResponse = await fetch(`${baseUrl}/api/external-apis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: entityName,
              type: queryType,
            }),
          });
          
          if (apiResponse.ok) {
            const apiData = await apiResponse.json();
            
            if (apiData.results && apiData.results.length > 0) {
              apiContentArray = apiData.results;
              apiContext = apiData.results
                .map((item: any, idx: number) => {
                  const dataStr = typeof item.data === 'object' 
                    ? JSON.stringify(item.data, null, 2).substring(0, 1000)
                    : String(item.data).substring(0, 1000);
                  return `[API-${idx + 1}] ${item.source}\n${dataStr}`;
                })
                .join('\n\n---\n\n');
              console.log(`✅ Found ${apiData.results.length} API results`);
            }
          }
        } catch (error: any) {
          console.error('❌ API query error:', error);
        }
      }

      // ========================================
      // 4. COMBINE ALL CONTEXTS
      // ========================================
      const dbContext = context && context.length > 0
        ? context.map((item: any, idx: number) => {
            let relevantContent: string = item.content;
            
            if (keywords.length > 0) {
              const paragraphs: string[] = item.content.split('\n\n');
              const relevantParagraphs: string[] = paragraphs.filter((p: string) => 
                keywords.some((k: string) => p.toLowerCase().includes(k.toLowerCase()))
              );
              
              if (relevantParagraphs.length > 0) {
                relevantContent = relevantParagraphs.join('\n\n').substring(0, 1500);
              } else {
                relevantContent = item.content.substring(0, 1500);
              }
            } else {
              relevantContent = item.content.substring(0, 1500);
            }
            
            return `[DB-${idx + 1}] ${item.source}${item.date ? ` - ${item.date}` : ''}: ${item.title}\n${relevantContent}`;
          }).join('\n\n---\n\n')
        : '';

      const allContexts = [dbContext, webContext, apiContext].filter(Boolean);
      const hasContext = allContexts.length > 0;
      const contextText = allContexts.join('\n\n━━━━━━ ADDITIONAL SOURCES ━━━━━━\n\n');

      const citations = extractCitations(contextText, webContentArray, apiContentArray);

      // ========================================
      // 5. GENERATE AI RESPONSE
      // ========================================
      const systemPrompt = lang === 'it'
        ? `Sei Panda 🐼, esperto compliance AML/CFT italiano.

STILE: Diretto, preciso, professionale. NO saluti automatici.

STRUTTURA RISPOSTA:

DOMANDA SPECIFICA (es. "indicatori anomalia istituti pagamento"):
1. Vai DIRETTO ai dati ESATTI dai documenti
2. Lista PRECISA (numerata)
3. Cita fonte per ogni punto: (1), (2), (3)
4. MAX 150 parole
5. NO esempi generici se hai dati concreti

DOMANDA GENERICA (es. "cos'è AML"):
1. Definizione breve (2-3 righe)
2. 3-5 punti chiave con •
3. Esempio SE utile
4. MAX 250 parole

CASI SPECIALI:

INDICATORI ANOMALIA:
✅ CORRETTO: Estrai lista ESATTA da documento
"Secondo UIF (1):
1. Frazionamento sotto €15.000
2. Uso ripetuto contanti
3. Transazioni paesi non cooperativi"

❌ SBAGLIATO: "Transazioni sospette, comportamenti insoliti..."

NORMATIVA: Cita ESATTAMENTE testo, specifica art./comma

CITAZIONI: (1), (2), (3) nel testo. Fonti in fondo automatiche.

${hasContext ? `FONTI:
${contextText}

PRIORITÀ:
1. API = real-time
2. WEB = aggiornate (PREFERISCI SE DISPONIBILI)
3. DB = base documentale

REGOLE:
- Se WEB ha risposta specifica → USA QUELLA
- Estrai DATI SPECIFICI quando disponibili
- Diversifica fonti (FATF + EBA + UIF)
- Se DB vecchio + WEB recente → USA WEB` : `NESSUNA FONTE.
- NON inventare
- Ammetti: "Non ho documenti specifici"
- Suggerisci fonti ufficiali`}

Messaggio: "${message}"

Rispondi PRECISO e CONCISO. Usa (1), (2) per citare.`
        : `You are Panda 🐼, AML/CFT compliance expert.

STYLE: Direct, precise, professional. NO auto-greetings.

ANSWER STRUCTURE:

SPECIFIC QUESTION (e.g., "anomaly indicators payment institutions"):
1. Go DIRECT to EXACT data from documents
2. PRECISE list (numbered)
3. Cite source for each point: (1), (2), (3)
4. MAX 150 words
5. NO generic examples if you have concrete data

GENERIC QUESTION (e.g., "what is AML"):
1. Brief definition (2-3 lines)
2. 3-5 key points with •
3. Example IF useful
4. MAX 250 words

SPECIAL CASES:

ANOMALY INDICATORS:
✅ CORRECT: Extract EXACT list from document
"Per UIF (1):
1. Structuring below €15,000
2. Repeated cash use
3. Transactions to non-cooperative countries"

❌ WRONG: "Suspicious transactions, unusual behavior..."

LEGISLATION: Cite EXACTLY, specify art./section

CITATIONS: (1), (2), (3) in text. Full sources auto-added.

${hasContext ? `SOURCES:
${contextText}

PRIORITY:
1. API = real-time
2. WEB = updated (PREFER IF AVAILABLE)
3. DB = documentation base

RULES:
- If WEB has specific answer → USE THAT
- Extract SPECIFIC DATA when available
- Diversify sources (FATF + EBA + UIF)
- If old DB + recent WEB → USE WEB` : `NO SOURCES.
- Don't invent
- Admit: "I don't have specific documents"
- Suggest official sources`}

Message: "${message}"

Respond PRECISELY and CONCISELY. Use (1), (2) to cite.`;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.8,
        max_tokens: 1800,
      });

      let response = completion.choices[0]?.message?.content || 
        (lang === 'it' ? 'Errore. Riprova.' : 'Error. Try again.');

      response = response.replace(/^["']|["']$/g, '');
      if (response.startsWith('"') && response.endsWith('"')) {
        response = response.slice(1, -1);
      }
      if (response.startsWith("'") && response.endsWith("'")) {
        response = response.slice(1, -1);
      }

      if (citations.length > 0) {
        response += buildCitationsFooter(citations, lang);
      }

      responseCache.set(cacheKey, { response, timestamp: Date.now() });

      if (responseCache.size > 100) {
        const entries = Array.from(responseCache.entries());
        const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        responseCache.clear();
        sorted.slice(0, 100).forEach(([key, value]) => responseCache.set(key, value));
      }

      return NextResponse.json({ response, cached: false });
    }

    // ========================================
    // HANDLE SIMPLE GREETINGS
    // ========================================
    const simpleResponsePrompt = lang === 'it'
      ? `Sei Panda 🐼, rispondi brevemente (max 2 righe):
"${message}"
NO virgolette. Italiano friendly. Invita a domande AML/CFT.`
      : `You are Panda 🐼, respond briefly (max 2 lines):
"${message}"
NO quotes. English friendly. Invite AML/CFT questions.`;

    const simpleCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: simpleResponsePrompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.9,
      max_tokens: 100,
    });

    let simpleResponse = simpleCompletion.choices[0]?.message?.content?.trim() ||
      (lang === 'it' ? 'Ciao! Come posso aiutarti?' : 'Hello! How can I help?');

    simpleResponse = simpleResponse.replace(/^["']|["']$/g, '');
    if (simpleResponse.startsWith('"') && simpleResponse.endsWith('"')) {
      simpleResponse = simpleResponse.slice(1, -1);
    }
    if (simpleResponse.startsWith("'") && simpleResponse.endsWith("'")) {
      simpleResponse = simpleResponse.slice(1, -1);
    }

    return NextResponse.json({ response: simpleResponse });

  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
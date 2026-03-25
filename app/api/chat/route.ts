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
- "primary_intent": the MAIN intent of the message
  * "greeting": ONLY if it's a simple greeting AND user clearly doesn't want anything else
    Examples: "ciao", "hello", "hey"
  * "how_are_you": ONLY if JUST asking wellbeing
  * "compliance_question": if there's ANY hint of wanting AML/compliance info
    Examples: "ciao panda" (in compliance context), "ultime notizie", "veloce", "controlla internet"
    Even vague requests like "fammi vedere" or "dimostra" count as compliance_question
  * "off_topic": only completely unrelated topics

- "has_compliance_question": true if ANY indication user wants compliance info
  Keywords: AML, CFT, KYC, notizie, ultime, veloce, dimostra, controlla, cerca, internet

- If greeting seems conversational but in compliance context, set:
  primary_intent: "compliance_question"
  has_compliance_question: true

Return ONLY the JSON.`;

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

  // Extract WEB sources
  if (webContent && webContent.length > 0) {
    webContent.forEach(item => {
      citations.push({
        id: citationId++,
        source: item.source || 'Web',
        title: item.title || 'Documento web',
        url: item.url,
      });
    });
  }

  // Extract API sources
  if (apiContent && apiContent.length > 0) {
    apiContent.forEach(item => {
      citations.push({
        id: citationId++,
        source: item.source || 'API',
        title: typeof item.data === 'string' ? item.data.substring(0, 80) : 'API Result',
        url: item.url,
      });
    });
  }

  // Extract DB sources from context text
  const dbMatches = contextText.match(/\[DB - ([^\]]+?)(?: - (\d{4}-\d{2}-\d{2}))?\]/g);
  if (dbMatches) {
    const uniqueDB = new Set();
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
      // 1. SEARCH DATABASE
      // ========================================
      let { data: context } = await supabase
        .from('aml_knowledge')
        .select('content, source, title, date')
        .textSearch('content', message)
        .order('date', { ascending: false })
        .limit(8);

      const shouldPrioritizeWeb = !context || 
        context.length < 3 || 
        (context.every(c => !c.date || new Date(c.date) < new Date('2023-01-01')));

      console.log(`📊 Database results: ${context?.length || 0}`);
      console.log(`🌐 Should search web: ${shouldSearchWeb(message)}`);
      console.log(`⚡ Should prioritize web: ${shouldPrioritizeWeb}`);

      if (!context || context.length === 0) {
        console.log('⚠️  No database results, will rely on web search');
        context = [];
      }

      // ========================================
      // 2. SEARCH WEB (prioritize if DB insufficient)
      // ========================================
      let webContext = '';
      let webContentArray: any[] = [];
      const needsWebSearch = shouldSearchWeb(message) || shouldPrioritizeWeb;

      console.log(`🔍 Web search decision: ${needsWebSearch ? 'YES' : 'NO'}`);

      if (needsWebSearch) {
        try {
          console.log('🌐 Triggering web search (priority)...');
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
        ? context.map((item, idx) => `[DB-${idx + 1}] ${item.source}${item.date ? ` - ${item.date}` : ''}: ${item.title}\n${item.content}`).join('\n\n---\n\n')
        : '';

      const allContexts = [dbContext, webContext, apiContext].filter(Boolean);
      const hasContext = allContexts.length > 0;
      const contextText = allContexts.join('\n\n━━━━━━ ADDITIONAL SOURCES ━━━━━━\n\n');

      // Build citations
      const citations = extractCitations(contextText, webContentArray, apiContentArray);

      // ========================================
      // 5. GENERATE AI RESPONSE
      // ========================================
      const systemPrompt = lang === 'it'
        ? `Sei Panda 🐼, un esperto italiano di compliance AML/CFT.

IMPORTANTE: Rispondi SEMPRE in italiano naturale. MAI in inglese.

NON iniziare MAI con saluti a meno che l'utente non chieda esplicitamente come stai.
Vai DIRETTAMENTE alla risposta.

STILE:
- Naturale, mai robotico
- Diretto e utile
- Usa esempi quando aiutano
- NO frasi template
- NON usare MAI virgolette (" ") all'inizio o fine della risposta

STRUTTURA:
1. Vai DIRETTAMENTE alla risposta
2. Dettagli chiave (3-5 punti con •)
3. Esempio pratico se utile
4. CITAZIONI - Usa numeri tra parentesi: (1), (2), (3)
   Esempio: "La roadmap Appia è stata presentata il 20 marzo (1)"
   NON scrivere [WEB - fonte] inline
   Le fonti complete verranno aggiunte automaticamente alla fine

${hasContext ? `FONTI DISPONIBILI:
${contextText}

PRIORITÀ FONTI:
1. [API-X] = REAL-TIME (massima priorità)
2. [WEB-X] = Aggiornate 2024-2026
3. [DB-X] = Documentazione generale

DIVERSITÀ FONTI:
- Usa fonti DIVERSE quando disponibili
- Non concentrarti solo su una fonte (es. solo Banca Italia)
- FATF/EBA per normativa internazionale
- Banca Italia/UIF per Italia

REGOLE CITAZIONI:
- Usa (1), (2), (3) per citare
- Esempio: "La FATF ha pubblicato linee guida (1)"
- NON scrivere [WEB - ...] nel testo
- Cita fonte quando usi informazione specifica` : `NESSUNA FONTE disponibile.

REGOLE:
- NON inventare fonti
- Ammetti: "Non ho trovato documenti aggiornati"
- Puoi dare info generali ma specifica che sono da conoscenza generale
- Suggerisci consultare siti ufficiali: UIF, FATF, EBA`}

Messaggio utente: "${message}"

Rispondi naturalmente senza virgolette. Usa (1), (2) per citazioni.`
        : `You are Panda 🐼, an AML/CFT compliance expert.

IMPORTANT: Always respond in natural English.

NEVER start with greetings unless user explicitly asks how you are.
Go DIRECTLY to the answer.

STYLE:
- Natural, never robotic
- Direct and useful
- Use examples when helpful
- NO template phrases
- NEVER use quotation marks (" ") at start or end

STRUCTURE:
1. Go DIRECTLY to the answer
2. Key details (3-5 points with •)
3. Practical example if useful
4. CITATIONS - Use numbers in parentheses: (1), (2), (3)
   Example: "FATF published new guidelines (1)"
   Do NOT write [WEB - source] inline
   Full sources will be added automatically at the end

${hasContext ? `AVAILABLE SOURCES:
${contextText}

SOURCE PRIORITY:
1. [API-X] = REAL-TIME (highest priority)
2. [WEB-X] = Updated 2024-2026
3. [DB-X] = General documentation

SOURCE DIVERSITY:
- Use DIFFERENT sources when available
- Don't focus only on one source (e.g., only Banca Italia)
- FATF/EBA for international regulation
- Banca Italia/UIF for Italy

CITATION RULES:
- Use (1), (2), (3) to cite
- Example: "FATF published guidelines (1)"
- Do NOT write [WEB - ...] in text
- Cite source when using specific information` : `NO SOURCES available.

RULES:
- Do NOT make up sources
- Admit: "I didn't find updated documents"
- Can provide general info but specify it's from general knowledge
- Suggest consulting official sites: UIF, FATF, EBA`}

User message: "${message}"

Respond naturally without quotes. Use (1), (2) for citations.`;

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

      // Clean quotes
      response = response.replace(/^["']|["']$/g, '');
      if (response.startsWith('"') && response.endsWith('"')) {
        response = response.slice(1, -1);
      }
      if (response.startsWith("'") && response.endsWith("'")) {
        response = response.slice(1, -1);
      }

      // Add citations footer
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
      ? `Sei Panda 🐼, rispondi a questo saluto in modo naturale e breve (max 2 righe):

"${message}"

IMPORTANTE: 
- NON usare virgolette (" ")
- Rispondi in italiano friendly
- Invita a domande su AML/CFT

Senza virgolette.`
      : `You are Panda 🐼, respond to this greeting naturally and briefly (max 2 lines):

"${message}"

IMPORTANT:
- Do NOT use quotation marks (" ")
- Respond in English with friendly personality
- Invite to ask about AML/CFT

Without quotation marks.`;

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
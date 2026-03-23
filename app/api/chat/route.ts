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
    'dimostra', 'cerca', 'trova', 'search',
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
  * "greeting": ONLY if it's JUST a greeting with nothing else
    Examples: "ciao", "hello", "hey panda"
  * "how_are_you": ONLY if it's JUST asking wellbeing
    Examples: "come stai?", "how are you?"
  * "compliance_question": if there's ANY compliance question (even with greetings before)
    Examples: "ciao, cos'è la fatf?", "hey, explain kyc", "come stai? poi vorrei sapere..."
  * "off_topic": everything else

- "has_compliance_question": true if the message contains ANY compliance question, regardless of greetings
  Check for keywords: AML, CFT, KYC, CDD, FATF, regulations, normativa, antiriciclaggio, etc.

- "language": 
  * "it" if Italian words detected
  * "en" otherwise

IMPORTANT: If message contains both greeting AND compliance question, set:
- primary_intent: "compliance_question"
- has_compliance_question: true

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
              webContext = webData.content
                .map((item: any) => `[WEB - ${item.source}] ${item.title}\n${item.content}`)
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
              apiContext = apiData.results
                .map((item: any) => {
                  const dataStr = typeof item.data === 'object' 
                    ? JSON.stringify(item.data, null, 2).substring(0, 1000)
                    : String(item.data).substring(0, 1000);
                  return `[API - ${item.source}]\n${dataStr}`;
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
        ? context.map(item => `[DB - ${item.source}${item.date ? ` - ${item.date}` : ''}] ${item.title}:\n${item.content}`).join('\n\n---\n\n')
        : '';

      const allContexts = [dbContext, webContext, apiContext].filter(Boolean);
      const hasContext = allContexts.length > 0;
      const contextText = allContexts.join('\n\n━━━━━━ ADDITIONAL SOURCES ━━━━━━\n\n');

      // ========================================
      // 5. GENERATE AI RESPONSE
      // ========================================
      const systemPrompt = lang === 'it'
        ? `Sei Panda 🐼, un esperto italiano di compliance AML/CFT.

IMPORTANTE: Rispondi SEMPRE in italiano naturale. MAI in inglese.

NON iniziare MAI con "Ciao! Tutto bene grazie" a meno che l'utente non abbia esplicitamente chiesto come stai.
Vai DIRETTAMENTE alla risposta della domanda.

STILE:
- Naturale, mai robotico
- Diretto e utile
- Usa esempi quando aiutano
- NO frasi template tipo "Pronto ad aiutarti"
- NON usare MAI virgolette (" ") all'inizio o fine della risposta
- Scrivi come se stessi parlando naturalmente con un collega

STRUTTURA:
1. Vai DIRETTAMENTE alla risposta
2. Dettagli chiave (3-5 punti con •)
3. Esempio pratico se utile
4. Fonti: cita esplicitamente [DB - fonte], [WEB - fonte], [API - fonte] con DATE quando disponibili

${hasContext ? `FONTI DISPONIBILI:
${contextText}

PRIORITÀ FONTI (dal più al meno affidabile):
1. [API - fonte] = Dati REAL-TIME, massima priorità (es. sanctions, companies)
2. [WEB - fonte] = Informazioni AGGIORNATE da siti ufficiali (2024-2026)
3. [DB - fonte] = Documentazione generale (potrebbe essere datata)

REGOLE FONDAMENTALI:
- CITA SOLO fonti che ti ho fornito con tag [DB], [WEB], [API]
- NON inventare MAI fonti (Il Sole 24 Ore, Reuters, Bloomberg, UNODC, ecc.)
- Se NON hai fonti specifiche, dillo chiaramente: "Non ho trovato documenti aggiornati"
- Se trovi info contrastanti, dai priorità a API > WEB > DB
- Se DB ha documenti vecchi (<2023) E hai risultati WEB recenti (>2023), usa SOLO WEB
- Cita SEMPRE la data quando disponibile (es. "[WEB - UIF - 2025-03-15]")
- Se chiedi di liste/sanzioni aggiornate, usa SOLO API e WEB, MAI DB
- Se database è vuoto o irrilevante E non hai risultati WEB, AMMETTI di non avere info aggiornate
- Specifica quando hai cercato su internet per rispondere alla domanda` : `NESSUNA FONTE DISPONIBILE nel database o dal web.

REGOLE CRITICHE:
- NON inventare NESSUNA fonte (Il Sole 24 Ore, Reuters, Bloomberg, UNODC, ecc.)
- Ammetti onestamente: "Non ho trovato documenti aggiornati nel database e la ricerca web non ha prodotto risultati"
- Puoi fornire informazioni GENERALI su AML/CFT ma specifica che sono da conoscenza generale, NON da fonti specifiche
- Suggerisci di consultare direttamente i siti ufficiali: UIF, FATF, EBA
- Se l'utente chiede "ultime notizie" o documenti recenti, AMMETTI se non riesci a trovarli`}

Messaggio utente: "${message}"

Rispondi in modo naturale e completo, senza virgolette. Se citi fonti, devono essere SOLO quelle con tag [DB]/[WEB]/[API] che ti ho fornito.`
        : `You are Panda 🐼, an AML/CFT compliance expert.

IMPORTANT: Always respond in natural English. NEVER in Italian.

NEVER start with "Hey! I'm great, thanks" unless user explicitly asked how you are.
Go DIRECTLY to answering the question.

STYLE:
- Natural, never robotic
- Direct and useful
- Use examples when helpful
- NO template phrases like "Ready to help"
- NEVER use quotation marks (" ") at the start or end of your response
- Write as if you're naturally talking to a colleague

STRUCTURE:
1. Go DIRECTLY to the answer
2. Key details (3-5 points with •)
3. Practical example if useful
4. Sources: explicitly cite [DB - source], [WEB - source], [API - source] with DATES when available

${hasContext ? `AVAILABLE SOURCES:
${contextText}

SOURCE PRIORITY (most to least reliable):
1. [API - source] = REAL-TIME data, highest priority (e.g., sanctions, companies)
2. [WEB - source] = UPDATED information from official sites (2024-2026)
3. [DB - source] = General documentation (might be outdated)

FUNDAMENTAL RULES:
- CITE ONLY sources provided with [DB], [WEB], [API] tags
- NEVER make up sources (Il Sole 24 Ore, Reuters, Bloomberg, UNODC, etc.)
- If NO specific sources, state clearly: "I didn't find updated documents"
- If conflicting info, prioritize API > WEB > DB
- If DB has old docs (<2023) AND you have recent WEB results (>2023), use ONLY WEB
- ALWAYS cite date when available (e.g., "[WEB - UIF - 2025-03-15]")
- For updated lists/sanctions, use ONLY API and WEB, NEVER DB
- If database is empty or irrelevant AND no WEB results, ADMIT you don't have updated info
- Specify when you searched the internet to answer the question` : `NO SOURCES AVAILABLE from database or web.

CRITICAL RULES:
- DO NOT make up ANY sources (Il Sole 24 Ore, Reuters, Bloomberg, UNODC, etc.)
- Admit honestly: "I didn't find updated documents in the database and web search returned no results"
- You can provide GENERAL AML/CFT information but specify it's from general knowledge, NOT specific sources
- Suggest consulting official sites directly: UIF, FATF, EBA
- If user asks for "latest news" or recent documents, ADMIT if you can't find them`}

User message: "${message}"

Respond naturally and completely, without quotation marks. If citing sources, they must ONLY be those with [DB]/[WEB]/[API] tags that I provided.`;

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
- NON usare virgolette (" ") nella risposta
- Scrivi il testo direttamente senza quotation marks
- Rispondi in italiano con personalità friendly
- Invita l'utente a fare domande su AML/CFT

Scrivi la risposta senza virgolette.`
      : `You are Panda 🐼, respond to this greeting naturally and briefly (max 2 lines):

"${message}"

IMPORTANT:
- Do NOT use quotation marks (" ") in your response
- Write text directly without quotes
- Respond in English with friendly personality
- Invite user to ask about AML/CFT

Write response without quotation marks.`;

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

export const runtime = 'edge';